//! Google OAuth 2.0 sign-in (loopback redirect flow for desktop apps).
//!
//! The flow: open the system browser at Google's consent screen with a
//! one-time `state`, receive the redirect on http://localhost:17927/callback,
//! exchange the code for an access token and load the Google profile.

use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::path::Path;
use std::sync::mpsc;
use std::time::Duration;

use crate::db::DbState;
use crate::types::SessionUser;
use rusqlite::{Connection, OptionalExtension, params};
use serde::Deserialize;
use tauri::{Emitter, State};
use tauri_plugin_opener::OpenerExt;

const AUTH_ENDPOINT: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT: &str = "https://www.googleapis.com/oauth2/v3/userinfo";
const SCOPES: &str = "openid email profile";
const CALLBACK_PORT: u16 = 17927;
const CALLBACK_PATH: &str = "/callback";
const LOGIN_TIMEOUT: Duration = Duration::from_secs(300);

struct OAuthClient {
    client_id: String,
    client_secret: String,
    redirect_uri: String,
}

#[derive(Debug, Deserialize)]
struct GoogleProfile {
    sub: String,
    email: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    picture: Option<String>,
    #[serde(default)]
    email_verified: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

/// Reads the downloaded Google client file (`{"web": {...}}`, `{"installed": {...}}`
/// or a flat object) that lives next to `Cargo.toml` and is embedded at build time.
fn oauth_client() -> Result<OAuthClient, String> {
    let raw = include_str!("../google_oauth.json");
    let value: serde_json::Value = serde_json::from_str(raw)
        .map_err(|e| format!("google_oauth.json is not valid JSON: {e}"))?;
    let section = value
        .get("web")
        .or_else(|| value.get("installed"))
        .unwrap_or(&value);

    let field = |key: &str| -> Result<String, String> {
        section
            .get(key)
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| format!("google_oauth.json is missing {key}"))
    };

    Ok(OAuthClient {
        client_id: field("client_id")?,
        client_secret: field("client_secret")?,
        redirect_uri: format!("http://localhost:{CALLBACK_PORT}{CALLBACK_PATH}"),
    })
}

fn encode_component(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for byte in input.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

fn decode_component(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b'%' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("");
                match u8::from_str_radix(hex, 16) {
                    Ok(value) => {
                        out.push(value);
                        i += 3;
                    }
                    Err(_) => {
                        out.push(b'%');
                        i += 1;
                    }
                }
            }
            byte => {
                out.push(byte);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn query_param(target: &str, key: &str) -> Option<String> {
    let query = target.split_once('?')?.1;
    for pair in query.split('&') {
        if let Some((name, value)) = pair.split_once('=') {
            if name == key {
                return Some(decode_component(value));
            }
        }
    }
    None
}

fn result_page(success: bool) -> String {
    let title = if success {
        "Signed in"
    } else {
        "Sign-in failed"
    };
    let message = if success {
        "You can close this window and return to EventPulse."
    } else {
        "Google did not finish the sign-in. You can close this window and try again."
    };
    format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>{title}</title></head>\
         <body style=\"font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#f6f5f2;color:#1f1d1a;display:flex;align-items:center;justify-content:center;height:100vh;margin:0\">\
         <main style=\"background:#fff;border:1px solid #e6e2da;border-radius:14px;padding:32px 36px;text-align:center;max-width:420px\">\
         <h1 style=\"font-size:18px;margin:0 0 8px\">{title}</h1>\
         <p style=\"font-size:14px;color:#5c564d;margin:0\">{message}</p></main></body></html>"
    )
}

/// Listens on both loopback addresses of the redirect port (browsers may resolve
/// `localhost` to either `::1` or `127.0.0.1`) and forwards the first callback path.
fn start_callback_server() -> Result<mpsc::Receiver<String>, String> {
    let mut listeners = Vec::new();
    for address in [
        format!("127.0.0.1:{CALLBACK_PORT}"),
        format!("[::1]:{CALLBACK_PORT}"),
    ] {
        if let Ok(listener) = TcpListener::bind(&address) {
            listeners.push(listener);
        }
    }

    if listeners.is_empty() {
        return Err(format!(
            "Port {CALLBACK_PORT} is in use, so the Google redirect could not be received. Close the app using it and try again."
        ));
    }

    let (sender, receiver) = mpsc::channel();
    for listener in listeners {
        let sender = sender.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { break };
                let Ok(clone) = stream.try_clone() else {
                    continue;
                };
                let mut reader = BufReader::new(clone);
                let mut request_line = String::new();
                if reader.read_line(&mut request_line).is_err() {
                    continue;
                }
                let target = request_line
                    .split_whitespace()
                    .nth(1)
                    .unwrap_or("/")
                    .to_string();

                if !target.starts_with(CALLBACK_PATH) {
                    let _ = stream.write_all(
                        b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                    );
                    continue;
                }

                let page = result_page(query_param(&target, "code").is_some());
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    page.len(),
                    page
                );
                let _ = stream.write_all(response.as_bytes());
                let _ = stream.flush();
                let _ = sender.send(target);
                break;
            }
        });
    }

    Ok(receiver)
}

fn run_oauth_flow(app: &tauri::AppHandle) -> Result<(GoogleProfile, String), String> {
    let client = oauth_client()?;
    let receiver = start_callback_server()?;
    let state = uuid::Uuid::new_v4().to_string();

    let auth_url = format!(
        "{AUTH_ENDPOINT}?client_id={}&redirect_uri={}&response_type=code&scope={}&state={}&prompt=select_account",
        encode_component(&client.client_id),
        encode_component(&client.redirect_uri),
        encode_component(SCOPES),
        encode_component(&state)
    );

    app.opener()
        .open_url(auth_url, None::<&str>)
        .map_err(|e| format!("Could not open your browser for Google sign-in: {e}"))?;

    let target = receiver
        .recv_timeout(LOGIN_TIMEOUT)
        .map_err(|_| "Timed out waiting for the Google sign-in to finish.".to_string())?;

    if let Some(error) = query_param(&target, "error") {
        return Err(format!("Google sign-in was cancelled or denied ({error})."));
    }

    let code = query_param(&target, "code")
        .ok_or_else(|| "Google did not return an authorization code.".to_string())?;

    if query_param(&target, "state").as_deref() != Some(state.as_str()) {
        return Err("Google sign-in failed its security check (state mismatch).".to_string());
    }

    let http = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Could not create the HTTP client: {e}"))?;

    let token_response = http
        .post(TOKEN_ENDPOINT)
        .form(&[
            ("code", code.as_str()),
            ("client_id", client.client_id.as_str()),
            ("client_secret", client.client_secret.as_str()),
            ("redirect_uri", client.redirect_uri.as_str()),
            ("grant_type", "authorization_code"),
        ])
        .send()
        .map_err(|e| format!("Could not reach Google to exchange the sign-in code: {e}"))?;

    let status = token_response.status();
    let body = token_response
        .text()
        .map_err(|e| format!("Could not read Google's token response: {e}"))?;
    let token: TokenResponse = serde_json::from_str(&body)
        .map_err(|_| "Google returned an unexpected token response.".to_string())?;

    if !status.is_success() {
        let reason = token
            .error_description
            .or(token.error)
            .unwrap_or_else(|| format!("HTTP {status}"));
        return Err(format!("Google rejected the sign-in: {reason}"));
    }

    let access_token = token
        .access_token
        .ok_or_else(|| "Google did not return an access token.".to_string())?;

    let profile_body = http
        .get(USERINFO_ENDPOINT)
        .bearer_auth(&access_token)
        .send()
        .map_err(|e| format!("Could not load your Google profile: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Could not load your Google profile: {e}"))?
        .text()
        .map_err(|e| format!("Could not read your Google profile: {e}"))?;

    let profile: GoogleProfile = serde_json::from_str(&profile_body)
        .map_err(|_| "Google returned an unexpected profile.".to_string())?;

    if profile.email_verified == Some(false) {
        return Err("Your Google email address is not verified.".to_string());
    }

    Ok((profile, access_token))
}

fn row_to_user(row: &rusqlite::Row<'_>) -> rusqlite::Result<SessionUser> {
    Ok(SessionUser {
        id: row.get(0)?,
        name: row.get(1)?,
        email: row.get(2)?,
        avatar_url: row.get(3)?,
        workspace_role: row.get(4)?,
    })
}

fn upsert_user(db_path: &Path, profile: &GoogleProfile) -> Result<SessionUser, String> {
    let conn = Connection::open(db_path).map_err(|e| format!("Database error: {e}"))?;
    let now = chrono::Utc::now().to_rfc3339();
    let display_name = profile
        .name
        .clone()
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| {
            profile
                .email
                .split('@')
                .next()
                .unwrap_or("Google user")
                .to_string()
        });

    // Already linked to this Google account.
    let linked = conn
        .query_row(
            "SELECT id, name, email, avatar_url, workspace_role FROM users WHERE google_sub = ?1",
            params![&profile.sub],
            row_to_user,
        )
        .optional()
        .map_err(|e| format!("Database error: {e}"))?;

    if let Some(mut user) = linked {
        conn.execute(
            "UPDATE users SET name = ?2, avatar_url = COALESCE(?3, avatar_url) WHERE id = ?1",
            params![&user.id, &display_name, &profile.picture],
        )
        .map_err(|e| format!("Database error: {e}"))?;
        user.name = display_name;
        if profile.picture.is_some() {
            user.avatar_url = profile.picture.clone();
        }
        return Ok(user);
    }

    // An existing email/password account with this address: link the Google identity.
    let by_email = conn
        .query_row(
            "SELECT id, name, email, avatar_url, workspace_role FROM users WHERE email = ?1 COLLATE NOCASE",
            params![&profile.email],
            row_to_user,
        )
        .optional()
        .map_err(|e| format!("Database error: {e}"))?;

    if let Some(mut user) = by_email {
        conn.execute(
            "UPDATE users SET google_sub = ?2, avatar_url = COALESCE(?3, avatar_url) WHERE id = ?1",
            params![&user.id, &profile.sub, &profile.picture],
        )
        .map_err(|e| format!("Database error: {e}"))?;
        if profile.picture.is_some() {
            user.avatar_url = profile.picture.clone();
        }
        return Ok(user);
    }

    // First Google sign-in for this workspace.
    let count: i32 = conn
        .query_row("SELECT COUNT(*) FROM users", [], |row| row.get(0))
        .unwrap_or(0);
    let role = if count == 0 { "owner" } else { "member" };
    let id = uuid::Uuid::new_v4().to_string();

    conn.execute(
        "INSERT INTO users (id, name, email, provider, google_sub, avatar_url, workspace_role, created_at)\n         VALUES (?1, ?2, ?3, 'google', ?4, ?5, ?6, ?7)",
        params![
            &id,
            &display_name,
            &profile.email,
            &profile.sub,
            &profile.picture,
            role,
            &now
        ],
    )
    .map_err(|e| format!("Database error: {e}"))?;

    conn.execute(
        "INSERT INTO user_preferences (user_id, event_reminders, email_updates, weekly_digest, updated_at)\n         VALUES (?1, 1, 1, 0, ?2)",
        params![&id, &now],
    )
    .ok();

    Ok(SessionUser {
        id,
        name: display_name,
        email: profile.email.clone(),
        avatar_url: profile.picture.clone(),
        workspace_role: role.to_string(),
    })
}

#[tauri::command]
pub async fn google_sign_in(
    app: tauri::AppHandle,
    state: State<'_, DbState>,
) -> Result<SessionUser, String> {
    let db_path = {
        let guard = state.0.lock().unwrap();
        match guard.as_ref() {
            Some(path) => path.clone(),
            None => return Err("The database is not ready yet. Try again in a moment.".to_string()),
        }
    };

    tauri::async_runtime::spawn_blocking(move || -> Result<SessionUser, String> {
        let (profile, google_access_token) = run_oauth_flow(&app)?;
        let user = upsert_user(&db_path, &profile)?;

        // Google sign-in has no website password to use for pairing. The
        // short-lived Google access token is validated by the website and is
        // never persisted in the desktop app or sent to the frontend.
        if let Err(error) =
            crate::sync::auto_pair_google_account(&db_path, &user, &google_access_token)
        {
            eprintln!("Automatic website sync pairing failed: {error}");
            crate::sync::record_pairing_error(&db_path, &error);
            let _ = app.emit("sync-pairing-error", error);
        } else {
            let _ = app.emit("sync-pairing-success", ());
        }

        Ok(user)
    })
    .await
    .map_err(|error| format!("Google sign-in failed: {error}"))?
}
