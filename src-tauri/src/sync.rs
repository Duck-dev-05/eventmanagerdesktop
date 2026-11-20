//! Two-way event sync with the Event Manager website.
//!
//! A background thread polls the website's /api/sync/pull endpoint every few
//! seconds (outbound HTTPS, so it works behind NAT) and pushes locally created
//! or changed events through /api/sync/push. Events changed on either side
//! appear on the other within seconds.

use crate::db::DbState;
use crate::types::{
    AvailableEventUser, CommandResult, EventRecord, InvitationSendResult, SyncedInvitation,
};
use chrono::Utc;
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use serde_json::{Value, json};
use std::sync::{Condvar, LazyLock, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;

/// Poll the website at chat-like cadence; wakes are instant.
const POLL_INTERVAL_MS: u64 = 1500;
const HTTP_TIMEOUT_SECS: u64 = 15;
const MAX_PUSH_BATCH: usize = 200;

/// The production website this desktop build syncs with. Auto-pairing uses
/// the signed-in user's credentials against this origin — no manual token
/// entry anywhere in the UI.
const DEFAULT_WEBSITE_URL: &str = "https://eventmanager-5dsz.vercel.app";

/// Wakes the sync thread instantly (e.g. the moment a local event is
/// created, edited or deleted) so pushes fire immediately instead of
/// waiting for the next poll tick.
static SYNC_WAKE: LazyLock<(Mutex<u64>, Condvar)> =
    LazyLock::new(|| (Mutex::new(0), Condvar::new()));

pub fn wake_sync() {
    let (lock, cvar) = &*SYNC_WAKE;
    let mut pending = lock.lock().unwrap();
    *pending += 1;
    cvar.notify_all();
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncConfigInfo {
    pub connected: bool,
    pub website_url: String,
    pub paired_account_email: String,
    pub last_sync_at: Option<String>,
    pub last_error: Option<String>,
}

struct SyncConfig {
    website_url: String,
    token: String,
    device_id: String,
    local_user_id: String,
    last_pull_seq: i64,
}

pub fn is_paired_user(conn: &Connection, user_id: &str) -> bool {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sync_state WHERE id=1 AND local_user_id=?1 AND website_url<>'')",
        params![user_id],
        |row| row.get(0),
    ).unwrap_or(false)
}

fn load_config(conn: &Connection) -> Option<SyncConfig> {
    conn.query_row(
        "SELECT website_url, token, device_id, local_user_id, last_pull_seq
         FROM sync_state WHERE id = 1",
        [],
        |row| {
            Ok(SyncConfig {
                website_url: row.get(0)?,
                token: row.get(1)?,
                device_id: row.get(2)?,
                local_user_id: row.get(3)?,
                last_pull_seq: row.get(4)?,
            })
        },
    )
    .optional()
    .ok()
    .flatten()
    .filter(|c| !c.website_url.is_empty() && !c.token.is_empty())
}

fn record_sync_result(conn: &Connection, error: Option<&str>) {
    conn.execute(
        "UPDATE sync_state SET last_sync_at = ?1, last_error = ?2 WHERE id = 1",
        params![Utc::now().to_rfc3339(), error],
    )
    .ok();
}

/// Preserves a pairing failure even if it occurs during login before the UI
/// has attached its Tauri event listener.
pub fn record_pairing_error(db_path: &std::path::Path, error: &str) {
    let Ok(conn) = Connection::open(db_path) else {
        return;
    };
    if load_config(&conn).is_some() {
        return;
    }
    conn.execute(
        "INSERT INTO sync_state (id, website_url, token, device_id, local_user_id, paired_account_email, last_pull_seq, last_sync_at, last_error)
         VALUES (1, '', '', '', '', '', 0, ?1, ?2)
         ON CONFLICT(id) DO UPDATE SET last_sync_at = excluded.last_sync_at, last_error = excluded.last_error",
        params![Utc::now().to_rfc3339(), error],
    )
    .ok();
}

pub fn enqueue_notification_read(
    conn: &Connection,
    user_id: &str,
    notification_id: Option<&str>,
    mark_all: bool,
) -> rusqlite::Result<()> {
    if !mark_all && notification_id.is_none() {
        return Err(rusqlite::Error::InvalidParameterName(
            "notification id required".into(),
        ));
    }
    if load_config(conn).is_some_and(|config| config.local_user_id != user_id) {
        return Err(rusqlite::Error::InvalidParameterName(
            "notification account is not paired".into(),
        ));
    }
    conn.execute(
        "INSERT INTO sync_notification_read_outbox (id,user_id,notification_id,mark_all,created_at)
         VALUES (?1,?2,?3,?4,?5)",
        params![
            Uuid::new_v4().to_string(),
            user_id,
            notification_id,
            mark_all,
            Utc::now().to_rfc3339()
        ],
    )?;
    wake_sync();
    Ok(())
}

fn save_pull_cursor(conn: &Connection, seq: i64) {
    conn.execute(
        "UPDATE sync_state SET last_pull_seq = ?1 WHERE id = 1",
        params![seq],
    )
    .ok();
}

#[tauri::command]
pub fn request_password_reset(state: State<'_, DbState>, email: String) -> CommandResult<Value> {
    let email = email.trim().to_lowercase();
    if email.is_empty() || email.len() > 254 || !email.contains('@') {
        return CommandResult::err("Enter the email address for your account.");
    }
    let base = state
        .conn()
        .ok()
        .and_then(|conn| {
            load_config(&conn)
                .map(|config| config.website_url)
                .filter(|url| !url.is_empty())
        })
        .unwrap_or_else(|| DEFAULT_WEBSITE_URL.to_string());
    let response = match http_client()
        .post(format!(
            "{}/api/auth/password-reset",
            base.trim_end_matches('/')
        ))
        .json(&json!({ "email": email }))
        .send()
    {
        Ok(response) => response,
        Err(error) => return CommandResult::err(&format!("Could not reach the website: {error}")),
    };
    let status = response.status();
    let body = match response.json::<Value>() {
        Ok(body) => body,
        Err(_) => return CommandResult::err("The website response could not be read."),
    };
    if !status.is_success() {
        let message = body
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("Could not request a password reset.");
        return CommandResult::err(message);
    }
    CommandResult::ok(body)
}

pub fn verify_website_credentials(
    conn: &Connection,
    email: &str,
    password: &str,
) -> Result<bool, String> {
    let base = load_config(conn)
        .map(|config| config.website_url)
        .filter(|url| !url.is_empty())
        .unwrap_or_else(|| DEFAULT_WEBSITE_URL.to_string());
    let response = http_client()
        .post(format!(
            "{}/api/sync/verify-credentials",
            base.trim_end_matches('/')
        ))
        .json(&json!({ "email": email, "password": password }))
        .send()
        .map_err(|error| error.to_string())?;
    match response.status().as_u16() {
        200 => Ok(true),
        401 => Ok(false),
        429 => Err("Too many password attempts. Try again later.".into()),
        status => Err(format!("Credential verification returned HTTP {status}.")),
    }
}

fn http_client() -> reqwest::blocking::Client {
    reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(HTTP_TIMEOUT_SECS))
        .build()
        .expect("failed to build HTTP client")
}

/// Adds a local event mutation to the outbox so the next sync cycle pushes it
/// to the website. Called by the event commands.
pub fn enqueue_event_change(conn: &Connection, action: &str, payload: &Value) {
    conn.execute(
        "INSERT INTO sync_outbox (change_id, action, event_id, payload, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            Uuid::new_v4().to_string(),
            action,
            payload["id"].as_str().unwrap_or(""),
            payload.to_string(),
            Utc::now().to_rfc3339(),
        ],
    )
    .ok();

    // Like hitting "send" in a chat: the sync engine runs right now.
    wake_sync();
}

/// Reads a single event row as a JSON payload in the website's snake_case
/// shape (the format both changelogs use).
pub fn event_payload(conn: &Connection, event_id: &str) -> Option<Value> {
    conn.query_row(
        "SELECT id, owner_id, title, description, category, venue, starts_at,
                capacity, visibility, created_at
         FROM events WHERE id = ?1",
        params![event_id],
        |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "ownerId": row.get::<_, String>(1)?,
                "title": row.get::<_, String>(2)?,
                "description": row.get::<_, String>(3)?,
                "category": row.get::<_, String>(4)?,
                "venue": row.get::<_, String>(5)?,
                "startsAt": row.get::<_, String>(6)?,
                "capacity": row.get::<_, Option<i32>>(7)?,
                "visibility": row.get::<_, String>(8)?,
                "createdAt": row.get::<_, String>(9)?,
            }))
        },
    )
    .optional()
    .ok()
    .flatten()
}

/// Applies one event change pulled from the website. The website account owns
/// these events locally, so owner_id maps to the paired local user.
fn apply_event_change(conn: &Connection, local_user_id: &str, event: &Value) -> bool {
    let id = match event.get("id").and_then(Value::as_str) {
        Some(id) if !id.is_empty() => id.to_string(),
        _ => return false,
    };

    let title = event
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let starts_at = event
        .get("starts_at")
        .and_then(Value::as_str)
        .or_else(|| event.get("startsAt").and_then(Value::as_str))
        .unwrap_or("")
        .to_string();
    if title.is_empty() || starts_at.is_empty() {
        return false;
    }

    let description = event
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let category = event
        .get("category")
        .and_then(Value::as_str)
        .unwrap_or("Other")
        .to_string();
    let venue = event
        .get("venue")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let capacity = event
        .get("capacity")
        .and_then(Value::as_i64)
        .map(|c| c as i32);
    let visibility = event
        .get("visibility")
        .and_then(Value::as_str)
        .unwrap_or("private")
        .to_string();
    let created_at = event
        .get("created_at")
        .and_then(Value::as_str)
        .or_else(|| event.get("createdAt").and_then(Value::as_str))
        .unwrap_or("")
        .to_string();

    // Local ownership stays with the paired desktop user.

    conn.execute(
        "INSERT INTO events (id, owner_id, title, description, category, venue, starts_at, capacity, visibility, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           description = excluded.description,
           category = excluded.category,
           venue = excluded.venue,
           starts_at = excluded.starts_at,
           capacity = excluded.capacity,
           visibility = excluded.visibility",
        params![
            id,
            local_user_id,
            title,
            description,
            category,
            venue,
            starts_at,
            capacity,
            visibility,
            if created_at.is_empty() { Utc::now().to_rfc3339() } else { created_at },
        ],
    )
    .is_ok()
}

/// One pull + push cycle. Returns how many changes were applied locally.
fn run_cycle(app: &AppHandle) -> Result<usize, String> {
    let state: State<DbState> = app.state();
    let conn = state
        .conn()
        .map_err(|_| "database not initialised".to_string())?;

    let config = match load_config(&conn) {
        Some(c) => c,
        None => return Ok(0), // not paired; idle
    };

    let client = http_client();
    let base = config.website_url.trim_end_matches('/');
    let mut applied = 0;

    // Preferences are a small last-write-wins record. Keep local edits queued
    // on network errors and apply remote values only when no local save waits.
    let pending_preferences: Option<(String, String)> = conn
        .query_row(
            "SELECT payload,updated_at FROM sync_preferences_outbox WHERE user_id=?1",
            params![config.local_user_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    if let Some((payload, updated_at)) = pending_preferences {
        let response = client
            .post(format!("{base}/api/sync/preferences"))
            .header("Authorization", format!("Bearer {}", config.token))
            .json(&serde_json::from_str::<Value>(&payload).map_err(|error| error.to_string())?)
            .send()
            .map_err(|error| format!("preference sync failed: {error}"))?;
        if response.status().as_u16() == 401 {
            return Err("Sync token was rejected. Re-pair on the website.".to_string());
        }
        if !response.status().is_success() {
            return Err(format!(
                "preference sync failed: HTTP {}",
                response.status()
            ));
        }
        conn.execute(
            "DELETE FROM sync_preferences_outbox WHERE user_id=?1 AND updated_at=?2",
            params![config.local_user_id, updated_at],
        )
        .map_err(|error| error.to_string())?;
    }

    // ---- Push queued notification reads, retaining them across offline/error states ----
    let read_outbox: Vec<(String, String, Option<String>, bool)> = {
        let mut stmt = conn
            .prepare(
                "SELECT id,user_id,notification_id,mark_all FROM sync_notification_read_outbox
                 WHERE user_id=?1 ORDER BY created_at,id LIMIT 50",
            )
            .map_err(|error| error.to_string())?;
        let rows = stmt
            .query_map(params![config.local_user_id], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get::<_, bool>(3)?,
                ))
            })
            .map_err(|error| error.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?
    };
    for (id, user_id, notification_id, mark_all) in read_outbox {
        if user_id != config.local_user_id {
            continue;
        }
        let body = if mark_all {
            json!({ "markAll": true })
        } else if let Some(notification_id) = notification_id {
            json!({ "notificationId": notification_id })
        } else {
            continue;
        };
        let response = client
            .post(format!("{base}/api/sync/notifications/read"))
            .header("Authorization", format!("Bearer {}", config.token))
            .json(&body)
            .send()
            .map_err(|error| format!("notification read sync failed: {error}"))?;
        if response.status().as_u16() == 401 {
            return Err("Sync token was rejected. Re-pair on the website.".to_string());
        }
        if !response.status().is_success() {
            return Err(format!(
                "notification read sync failed: HTTP {}",
                response.status()
            ));
        }
        conn.execute(
            "DELETE FROM sync_notification_read_outbox WHERE id=?1",
            params![id],
        )
        .map_err(|error| error.to_string())?;
    }

    // ---- Push local changes first so edits leave immediately ----
    let outbox: Vec<(i64, String, String, String)> = {
        let mut stmt = conn
            .prepare(
                "SELECT seq, change_id, action, payload FROM sync_outbox
                 ORDER BY seq ASC LIMIT ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![MAX_PUSH_BATCH as i64], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };

    if !outbox.is_empty() {
        let changes: Vec<Value> = outbox
            .iter()
            .filter_map(|(_, change_id, action, payload)| {
                serde_json::from_str::<Value>(payload)
                    .ok()
                    .map(|event| json!({ "id": change_id, "action": action, "event": event }))
            })
            .collect();

        let response = client
            .post(format!("{base}/api/sync/push"))
            .header("Authorization", format!("Bearer {}", config.token))
            .header("X-Device-Id", &config.device_id)
            .json(&json!({ "changes": changes }))
            .send()
            .map_err(|e| format!("push failed: {e}"))?;

        if response.status().as_u16() == 401 {
            return Err("Sync token was rejected. Re-pair on the website.".to_string());
        }
        if !response.status().is_success() {
            return Err(format!("push failed: HTTP {}", response.status()));
        }

        let pushed: Vec<i64> = outbox.iter().map(|(seq, ..)| *seq).collect();
        for seq in pushed {
            conn.execute("DELETE FROM sync_outbox WHERE seq = ?1", params![seq])
                .map_err(|e| e.to_string())?;
        }
    }

    // ---- Pull website changes ----
    let response = client
        .post(format!("{base}/api/sync/pull"))
        .header("Authorization", format!("Bearer {}", config.token))
        .header("X-Device-Id", &config.device_id)
        .json(&json!({ "cursor": config.last_pull_seq }))
        .send()
        .map_err(|e| format!("pull failed: {e}"))?;

    if response.status().as_u16() == 401 {
        return Err("Sync token was rejected. Re-pair on the website.".to_string());
    }
    if !response.status().is_success() {
        return Err(format!("pull failed: HTTP {}", response.status()));
    }

    let body: Value = response
        .json()
        .map_err(|e| format!("bad pull response: {e}"))?;
    let cursor = body
        .get("cursor")
        .and_then(Value::as_i64)
        .unwrap_or(config.last_pull_seq);

    let remote_members = body.get("members").and_then(Value::as_array).cloned();
    let remote_invitations = body.get("invitations").and_then(Value::as_array).cloned();
    let remote_notifications = body.get("notifications").and_then(Value::as_array).cloned();
    let remote_shared_events = body.get("sharedEvents").and_then(Value::as_array).cloned();
    let mut profile_changed = false;
    if let Some(profile) = body.get("profile").filter(|value| value.is_object()) {
        let remote_name = profile.get("name").and_then(Value::as_str).unwrap_or("");
        let remote_avatar = profile
            .get("avatarUrl")
            .and_then(Value::as_str)
            .map(|value| {
                if value.starts_with('/') {
                    format!("{}{}", base, value)
                } else {
                    value.to_string()
                }
            });
        let current: (String, Option<String>) = conn
            .query_row(
                "SELECT name,avatar_url FROM users WHERE id=?1",
                params![config.local_user_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap_or_default();
        profile_changed = current.0 != remote_name || current.1 != remote_avatar;
        if profile_changed {
            conn.execute(
                "UPDATE users SET name=?1,avatar_url=?2 WHERE id=?3",
                params![remote_name, remote_avatar, config.local_user_id],
            )
            .map_err(|error| format!("could not apply website profile: {error}"))?;
        }
    }
    let mut preferences_changed = false;
    if let Some(preferences) = body.get("preferences").filter(|value| value.is_object()) {
        let has_pending: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sync_preferences_outbox WHERE user_id=?1)",
                params![config.local_user_id],
                |row| row.get(0),
            )
            .unwrap_or(true);
        if !has_pending {
            let remote_updated = preferences
                .get("updatedAt")
                .and_then(Value::as_str)
                .unwrap_or("");
            let remote_values = (
                preferences
                    .get("eventReminders")
                    .and_then(Value::as_bool)
                    .unwrap_or(true),
                preferences
                    .get("emailUpdates")
                    .and_then(Value::as_bool)
                    .unwrap_or(true),
                preferences
                    .get("weeklyDigest")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                preferences
                    .get("defaultCapacity")
                    .and_then(Value::as_i64)
                    .map(|value| value as i32),
            );
            let current_values: Option<(bool,bool,bool,Option<i32>)> = conn.query_row(
                "SELECT event_reminders,email_updates,weekly_digest,default_capacity FROM user_preferences WHERE user_id=?1",
                params![config.local_user_id],
                |row| Ok((row.get::<_,i32>(0)? != 0,row.get::<_,i32>(1)? != 0,row.get::<_,i32>(2)? != 0,row.get(3)?)),
            ).optional().unwrap_or(None);
            preferences_changed = current_values != Some(remote_values);
            conn.execute(
                "INSERT INTO user_preferences (user_id,event_reminders,email_updates,weekly_digest,default_capacity,updated_at)
                 VALUES (?1,?2,?3,?4,?5,?6)
                 ON CONFLICT(user_id) DO UPDATE SET event_reminders=excluded.event_reminders,email_updates=excluded.email_updates,weekly_digest=excluded.weekly_digest,default_capacity=excluded.default_capacity,updated_at=excluded.updated_at",
                params![
                    config.local_user_id,
                    preferences.get("eventReminders").and_then(Value::as_bool).unwrap_or(true) as i32,
                    preferences.get("emailUpdates").and_then(Value::as_bool).unwrap_or(true) as i32,
                    preferences.get("weeklyDigest").and_then(Value::as_bool).unwrap_or(false) as i32,
                    preferences.get("defaultCapacity").and_then(Value::as_i64).map(|value| value as i32),
                    remote_updated,
                ],
            ).map_err(|error| format!("could not apply website preferences: {error}"))?;
        }
    }

    let mut changes_to_apply: Vec<(String, Value)> = Vec::new();
    match body.get("mode").and_then(Value::as_str) {
        Some("snapshot") => {
            if let Some(events) = body.get("events").and_then(Value::as_array) {
                for event in events {
                    changes_to_apply.push(("upsert".to_string(), event.clone()));
                }
            }
        }
        _ => {
            if let Some(list) = body.get("changes").and_then(Value::as_array) {
                for change in list {
                    let action = change
                        .get("action")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string();
                    if action == "delete" {
                        // Deletions carry only the entity id, no event payload.
                        let id = change
                            .get("entityId")
                            .and_then(Value::as_str)
                            .or_else(|| {
                                change
                                    .get("event")
                                    .and_then(|e| e.get("id"))
                                    .and_then(Value::as_str)
                            })
                            .unwrap_or("")
                            .to_string();
                        if !id.is_empty() {
                            changes_to_apply.push((action, json!({ "id": id })));
                        }
                    } else if let Some(event) = change.get("event") {
                        if !event.is_null() {
                            changes_to_apply.push((action, event.clone()));
                        }
                    }
                }
            }
        }
    }

    for (action, event) in &changes_to_apply {
        if action == "delete" {
            let id = event.get("id").and_then(Value::as_str).unwrap_or("");
            if !id.is_empty() {
                let _ = conn.execute("DELETE FROM events WHERE id = ?1", params![id]);
                applied += 1;
            }
        } else if apply_event_change(&conn, &config.local_user_id, event) {
            applied += 1;
        }
    }

    let mut members_changed = false;
    if let Some(remote_members) = remote_members.as_ref() {
        let current_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM synced_event_members", [], |row| {
                row.get(0)
            })
            .map_err(|e| e.to_string())?;
        members_changed = current_count != remote_members.len() as i64;
        if !members_changed {
            for member in remote_members {
                let Some(id) = member.get("id").and_then(Value::as_str) else {
                    continue;
                };
                let role = member
                    .get("role")
                    .and_then(Value::as_str)
                    .unwrap_or("member");
                let exists: bool = conn
                    .query_row(
                        "SELECT EXISTS(SELECT 1 FROM synced_event_members
                         WHERE id = ?1 AND role = ?2 AND name = ?3 AND email = ?4)",
                        params![
                            id,
                            role,
                            member.get("name").and_then(Value::as_str).unwrap_or(""),
                            member.get("email").and_then(Value::as_str).unwrap_or(""),
                        ],
                        |row| row.get(0),
                    )
                    .map_err(|e| e.to_string())?;
                if !exists {
                    members_changed = true;
                    break;
                }
            }
        }
        let sync_transaction = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        sync_transaction
            .execute("DELETE FROM synced_event_members", [])
            .map_err(|e| e.to_string())?;
        {
            let mut insert = sync_transaction
                .prepare(
                    "INSERT INTO synced_event_members
                 (id, event_id, user_id, name, email, avatar_url, role, invited_at, status)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                )
                .map_err(|e| e.to_string())?;
            for member in remote_members {
                let Some(id) = member.get("id").and_then(Value::as_str) else {
                    continue;
                };
                let Some(event_id) = member
                    .get("eventId")
                    .or_else(|| member.get("event_id"))
                    .and_then(Value::as_str)
                else {
                    continue;
                };
                let Some(user_id) = member
                    .get("userId")
                    .or_else(|| member.get("user_id"))
                    .and_then(Value::as_str)
                else {
                    continue;
                };
                let Some(name) = member.get("name").and_then(Value::as_str) else {
                    continue;
                };
                let Some(email) = member.get("email").and_then(Value::as_str) else {
                    continue;
                };
                let role = member
                    .get("role")
                    .and_then(Value::as_str)
                    .unwrap_or("member");
                let invited_at = member
                    .get("invitedAt")
                    .or_else(|| member.get("invited_at"))
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let status = member
                    .get("status")
                    .and_then(Value::as_str)
                    .unwrap_or("accepted");
                let avatar_url = member
                    .get("avatarUrl")
                    .or_else(|| member.get("avatar_url"))
                    .and_then(Value::as_str);
                insert
                    .execute(params![
                        id, event_id, user_id, name, email, avatar_url, role, invited_at, status
                    ])
                    .map_err(|e| e.to_string())?;
            }
        }
        sync_transaction.commit().map_err(|e| e.to_string())?;
    }

    let mut invitations_changed = false;
    if let Some(remote_invitations) = remote_invitations.as_ref() {
        let current_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM synced_invitations", [], |row| {
                row.get(0)
            })
            .map_err(|error| error.to_string())?;
        invitations_changed = current_count != remote_invitations.len() as i64;
        if !invitations_changed {
            for invitation in remote_invitations {
                let Some(id) = invitation.get("id").and_then(Value::as_str) else {
                    continue;
                };
                let status = invitation
                    .get("status")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let exists = conn.query_row(
                    "SELECT EXISTS(SELECT 1 FROM synced_invitations WHERE id = ?1 AND status = ?2)",
                    params![id, status],
                    |row| row.get::<_, bool>(0),
                ).map_err(|error| error.to_string())?;
                if !exists {
                    invitations_changed = true;
                    break;
                }
            }
        }
        let transaction = conn
            .unchecked_transaction()
            .map_err(|error| error.to_string())?;
        transaction
            .execute("DELETE FROM synced_invitations", [])
            .map_err(|error| error.to_string())?;
        {
            let mut insert = transaction.prepare(
                "INSERT INTO synced_invitations
                 (id, event_id, email, role, status, created_at, expires_at, event_title, starts_at, venue, category, inviter_name)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            ).map_err(|error| error.to_string())?;
            for invitation in remote_invitations {
                let (Some(id), Some(event_id), Some(email)) = (
                    invitation.get("id").and_then(Value::as_str),
                    invitation
                        .get("eventId")
                        .or_else(|| invitation.get("event_id"))
                        .and_then(Value::as_str),
                    invitation.get("email").and_then(Value::as_str),
                ) else {
                    continue;
                };
                let status = invitation
                    .get("status")
                    .and_then(Value::as_str)
                    .unwrap_or("pending");
                if !matches!(status, "pending" | "accepted" | "declined") {
                    continue;
                }
                insert
                    .execute(params![
                        id,
                        event_id,
                        email,
                        invitation
                            .get("role")
                            .and_then(Value::as_str)
                            .unwrap_or("member"),
                        status,
                        invitation
                            .get("createdAt")
                            .or_else(|| invitation.get("created_at"))
                            .and_then(Value::as_str)
                            .unwrap_or(""),
                        invitation
                            .get("expiresAt")
                            .or_else(|| invitation.get("expires_at"))
                            .and_then(Value::as_str)
                            .unwrap_or(""),
                        invitation
                            .get("eventTitle")
                            .or_else(|| invitation.get("event_title"))
                            .and_then(Value::as_str)
                            .unwrap_or(""),
                        invitation
                            .get("startsAt")
                            .or_else(|| invitation.get("starts_at"))
                            .and_then(Value::as_str)
                            .unwrap_or(""),
                        invitation
                            .get("venue")
                            .and_then(Value::as_str)
                            .unwrap_or(""),
                        invitation
                            .get("category")
                            .and_then(Value::as_str)
                            .unwrap_or("Other"),
                        invitation
                            .get("inviterName")
                            .or_else(|| invitation.get("inviter_name"))
                            .and_then(Value::as_str),
                    ])
                    .map_err(|error| error.to_string())?;
            }
        }
        transaction.commit().map_err(|error| error.to_string())?;
    }

    let mut shared_events_changed = false;
    if let Some(remote_events) = remote_shared_events.as_ref() {
        let current_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM synced_shared_events", [], |row| {
                row.get(0)
            })
            .map_err(|error| error.to_string())?;
        shared_events_changed = current_count != remote_events.len() as i64;
        if !shared_events_changed {
            for event in remote_events {
                let Some(id) = event.get("id").and_then(Value::as_str) else {
                    continue;
                };
                let owner_id = event
                    .get("owner_id")
                    .or_else(|| event.get("ownerId"))
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let title = event.get("title").and_then(Value::as_str).unwrap_or("");
                let description = event
                    .get("description")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let category = event
                    .get("category")
                    .and_then(Value::as_str)
                    .unwrap_or("Other");
                let venue = event.get("venue").and_then(Value::as_str).unwrap_or("");
                let starts_at = event
                    .get("starts_at")
                    .or_else(|| event.get("startsAt"))
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let capacity = event.get("capacity").and_then(Value::as_i64);
                let visibility = event
                    .get("visibility")
                    .and_then(Value::as_str)
                    .unwrap_or("private");
                let created_at = event
                    .get("created_at")
                    .or_else(|| event.get("createdAt"))
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let exists = conn
                    .query_row(
                        "SELECT EXISTS(SELECT 1 FROM synced_shared_events
                     WHERE id = ?1 AND paired_user_id = ?2 AND owner_id = ?3 AND title = ?4
                       AND description = ?5 AND category = ?6 AND venue = ?7 AND starts_at = ?8
                       AND capacity IS ?9 AND visibility = ?10 AND created_at = ?11)",
                        params![
                            id,
                            config.local_user_id,
                            owner_id,
                            title,
                            description,
                            category,
                            venue,
                            starts_at,
                            capacity,
                            visibility,
                            created_at
                        ],
                        |row| row.get::<_, bool>(0),
                    )
                    .map_err(|error| error.to_string())?;
                if !exists {
                    shared_events_changed = true;
                    break;
                }
            }
        }
        let transaction = conn
            .unchecked_transaction()
            .map_err(|error| error.to_string())?;
        transaction
            .execute("DELETE FROM synced_shared_events", [])
            .map_err(|error| error.to_string())?;
        {
            let mut insert = transaction.prepare(
                "INSERT INTO synced_shared_events
                 (id, paired_user_id, owner_id, title, description, category, venue, starts_at, capacity, visibility, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            ).map_err(|error| error.to_string())?;
            for event in remote_events {
                let Some(id) = event.get("id").and_then(Value::as_str) else {
                    continue;
                };
                let starts_at = event
                    .get("starts_at")
                    .or_else(|| event.get("startsAt"))
                    .and_then(Value::as_str)
                    .unwrap_or("");
                if starts_at.is_empty() {
                    continue;
                }
                insert
                    .execute(params![
                        id,
                        config.local_user_id,
                        event
                            .get("owner_id")
                            .or_else(|| event.get("ownerId"))
                            .and_then(Value::as_str)
                            .unwrap_or(""),
                        event.get("title").and_then(Value::as_str).unwrap_or(""),
                        event
                            .get("description")
                            .and_then(Value::as_str)
                            .unwrap_or(""),
                        event
                            .get("category")
                            .and_then(Value::as_str)
                            .unwrap_or("Other"),
                        event.get("venue").and_then(Value::as_str).unwrap_or(""),
                        starts_at,
                        event
                            .get("capacity")
                            .and_then(Value::as_i64)
                            .map(|value| value as i32),
                        event
                            .get("visibility")
                            .and_then(Value::as_str)
                            .unwrap_or("private"),
                        event
                            .get("created_at")
                            .or_else(|| event.get("createdAt"))
                            .and_then(Value::as_str)
                            .unwrap_or(""),
                    ])
                    .map_err(|error| error.to_string())?;
            }
        }
        transaction.commit().map_err(|error| error.to_string())?;
    }

    if let Some(notifications) = remote_notifications.as_ref() {
        let transaction = conn
            .unchecked_transaction()
            .map_err(|error| error.to_string())?;
        {
            let mut insert = transaction.prepare(
                "INSERT INTO event_notifications (id,user_id,event_id,kind,title,message,link_url,read_at,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)
                 ON CONFLICT(id) DO UPDATE SET event_id=excluded.event_id,kind=excluded.kind,title=excluded.title,message=excluded.message,link_url=excluded.link_url,read_at=COALESCE(event_notifications.read_at,excluded.read_at),created_at=excluded.created_at", 
            ).map_err(|error| error.to_string())?;
            for notification in notifications {
                let (Some(id), Some(user_id)) = (
                    notification.get("id").and_then(Value::as_str),
                    notification
                        .get("userId")
                        .or_else(|| notification.get("user_id"))
                        .and_then(Value::as_str),
                ) else {
                    continue;
                };
                let _remote_user_id = user_id;
                let event_id = notification
                    .get("eventId")
                    .or_else(|| notification.get("event_id"))
                    .and_then(Value::as_str)
                    .filter(|event_id| {
                        transaction
                            .query_row(
                                "SELECT EXISTS(SELECT 1 FROM events WHERE id = ?1)",
                                params![event_id],
                                |row| row.get::<_, bool>(0),
                            )
                            .unwrap_or(false)
                    });
                insert
                    .execute(params![
                        id,
                        config.local_user_id,
                        event_id,
                        notification
                            .get("kind")
                            .and_then(Value::as_str)
                            .unwrap_or("update"),
                        notification
                            .get("title")
                            .and_then(Value::as_str)
                            .unwrap_or("EventPulse update"),
                        notification
                            .get("message")
                            .and_then(Value::as_str)
                            .unwrap_or(""),
                        notification
                            .get("linkUrl")
                            .or_else(|| notification.get("link_url"))
                            .and_then(Value::as_str)
                            .unwrap_or(""),
                        notification
                            .get("readAt")
                            .or_else(|| notification.get("read_at"))
                            .and_then(Value::as_str),
                        notification
                            .get("createdAt")
                            .or_else(|| notification.get("created_at"))
                            .and_then(Value::as_str)
                            .unwrap_or(""),
                    ])
                    .map_err(|error| error.to_string())?;
            }
        }
        transaction.commit().map_err(|error| error.to_string())?;
    }

    applied += crate::work_sync::sync_work(
        app,
        &conn,
        &client,
        base,
        &config.token,
        &config.device_id,
        &config.local_user_id,
    )?;

    if cursor != config.last_pull_seq {
        save_pull_cursor(&conn, cursor);
    }

    record_sync_result(&conn, None);
    Ok(applied
        + usize::from(members_changed)
        + usize::from(invitations_changed)
        + usize::from(shared_events_changed)
        + usize::from(profile_changed)
        + usize::from(preferences_changed))
}

/// Background loop: pushes and pulls like a chat client — every 1.5 s,
/// or instantly when woken by a local change.
fn sync_loop(app: AppHandle) {
    loop {
        let (lock, cvar) = &*SYNC_WAKE;
        let guard = lock.lock().unwrap();
        // Sleep until woken by wake_sync() or until the poll tick elapses;
        // either way, run a full cycle afterwards.
        let (mut pending, _) = cvar
            .wait_timeout_while(
                guard,
                std::time::Duration::from_millis(POLL_INTERVAL_MS),
                |pending| *pending == 0,
            )
            .unwrap();
        // The condvar returns the mutex guard still locked. Reset the wake
        // counter through that guard (not by locking again, which deadlocks).
        *pending = 0;
        drop(pending);

        match run_cycle(&app) {
            Ok(applied) if applied > 0 => {
                // The frontend listens for this to refresh open pages.
                let _ = app.emit("sync-applied", applied);
            }
            Ok(_) => {}
            Err(error) => {
                if let Some(state) = app.try_state::<DbState>() {
                    if let Ok(conn) = state.conn() {
                        if load_config(&conn).is_some() {
                            record_sync_result(&conn, Some(&error));
                        }
                    }
                }
            }
        }
    }
}

/// Spawns the background sync thread. Called once from app setup.
pub fn spawn(app_handle: &AppHandle) {
    let app = app_handle.clone();
    std::thread::spawn(move || sync_loop(app));
}

/// Attempts Google OAuth auto-pairing using the short-lived access token
/// received during desktop sign-in. This runs before returning to the UI, so
/// a successful Google sign-in also fetches the website snapshot immediately.
pub fn auto_pair_google_account(
    db_path: &std::path::Path,
    user: &crate::types::SessionUser,
    access_token: &str,
) -> Result<(), String> {
    let response = http_client()
        .post(format!("{DEFAULT_WEBSITE_URL}/api/sync/auto-pair-google"))
        .json(&json!({ "accessToken": access_token }))
        .send()
        .map_err(|e| format!("Could not reach website sync service: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let detail = response
            .json::<Value>()
            .ok()
            .and_then(|body| {
                body.get("error")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .unwrap_or_else(|| format!("HTTP {status}"));
        return Err(detail);
    }

    let body: Value = response
        .json()
        .map_err(|e| format!("Invalid website pairing response: {e}"))?;
    let token = body
        .get("token")
        .and_then(Value::as_str)
        .ok_or_else(|| "Website did not return a sync credential.".to_string())?;
    let website_email = body
        .pointer("/user/email")
        .and_then(Value::as_str)
        .unwrap_or_default();

    if !website_email.eq_ignore_ascii_case(&user.email) {
        return Err("The Google account does not match the signed-in desktop account.".to_string());
    }

    let conn = Connection::open(db_path).map_err(|e| format!("Database error: {e}"))?;
    activate_pairing(&conn, DEFAULT_WEBSITE_URL, token, &user.id, website_email);
    Ok(())
}

/* ------------------------------------------------------------------ */
/* Tauri commands (Settings page)                                      */
/* ------------------------------------------------------------------ */

fn config_info(conn: &Connection) -> SyncConfigInfo {
    let row: Option<(String, String, String, Option<String>, Option<String>)> = conn
        .query_row(
            "SELECT website_url, token, paired_account_email, last_sync_at, last_error
             FROM sync_state WHERE id = 1",
            [],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .optional()
        .ok()
        .flatten();

    match row {
        Some((url, _token, email, last_sync, last_error)) if !url.is_empty() => SyncConfigInfo {
            connected: true,
            website_url: url,
            paired_account_email: email,
            last_sync_at: last_sync,
            last_error,
        },
        Some((_, _, _, last_sync, last_error)) => SyncConfigInfo {
            connected: false,
            website_url: String::new(),
            paired_account_email: String::new(),
            last_sync_at: last_sync,
            last_error,
        },
        None => SyncConfigInfo {
            connected: false,
            website_url: String::new(),
            paired_account_email: String::new(),
            last_sync_at: None,
            last_error: None,
        },
    }
}

#[tauri::command]
pub fn list_synced_shared_events(
    state: State<'_, DbState>,
    user_id: String,
) -> CommandResult<Vec<EventRecord>> {
    let conn = match state.conn() {
        Ok(conn) => conn,
        Err(error) => return CommandResult::err(&format!("Database error: {error}")),
    };
    let mut statement = match conn.prepare(
        "SELECT e.id, e.owner_id, e.title, e.description, e.category, e.venue, e.starts_at, e.capacity, e.visibility, e.created_at
         FROM synced_shared_events e JOIN sync_state s ON s.id = 1
         WHERE e.paired_user_id = ?1 AND s.local_user_id = ?1 ORDER BY e.starts_at DESC",
    ) {
        Ok(statement) => statement,
        Err(error) => return CommandResult::err(&format!("Database error: {error}")),
    };
    let rows = match statement.query_map(params![user_id], |row| {
        Ok(EventRecord {
            id: row.get(0)?,
            owner_id: row.get(1)?,
            title: row.get(2)?,
            description: row.get(3)?,
            category: row.get(4)?,
            venue: row.get(5)?,
            starts_at: row.get(6)?,
            capacity: row.get(7)?,
            visibility: row.get(8)?,
            created_at: row.get(9)?,
        })
    }) {
        Ok(rows) => rows,
        Err(error) => return CommandResult::err(&format!("Database error: {error}")),
    };
    match rows.collect::<Result<Vec<_>, _>>() {
        Ok(events) => CommandResult::ok(events),
        Err(error) => CommandResult::err(&format!("Database error: {error}")),
    }
}

#[tauri::command]
pub fn list_synced_invitations(
    state: State<'_, DbState>,
    user_id: String,
) -> CommandResult<Vec<SyncedInvitation>> {
    let conn = match state.conn() {
        Ok(conn) => conn,
        Err(error) => return CommandResult::err(&format!("Database error: {error}")),
    };
    let paired_user = conn
        .query_row(
            "SELECT local_user_id FROM sync_state WHERE id = 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .ok()
        .flatten();
    if paired_user.as_deref() != Some(user_id.as_str()) {
        return CommandResult::err("The signed-in account is not paired with this device.");
    }
    let mut statement = match conn.prepare(
        "SELECT i.id, i.event_id, i.email, i.role, i.status, i.created_at, i.expires_at,
                i.event_title, i.starts_at, i.venue, i.category, i.inviter_name
         FROM synced_invitations i
         JOIN users u ON lower(u.email) = lower(i.email)
         WHERE u.id = ?1
         ORDER BY i.created_at DESC",
    ) {
        Ok(statement) => statement,
        Err(error) => return CommandResult::err(&format!("Database error: {error}")),
    };
    let rows = match statement.query_map(params![user_id], |row| {
        Ok(SyncedInvitation {
            id: row.get(0)?,
            event_id: row.get(1)?,
            email: row.get(2)?,
            role: row.get(3)?,
            status: row.get(4)?,
            created_at: row.get(5)?,
            expires_at: row.get(6)?,
            event_title: row.get(7)?,
            starts_at: row.get(8)?,
            venue: row.get(9)?,
            category: row.get(10)?,
            inviter_name: row.get(11)?,
        })
    }) {
        Ok(rows) => rows,
        Err(error) => return CommandResult::err(&format!("Database error: {error}")),
    };
    match rows.collect::<Result<Vec<_>, _>>() {
        Ok(invitations) => CommandResult::ok(invitations),
        Err(error) => CommandResult::err(&format!("Database error: {error}")),
    }
}

#[tauri::command]
pub fn respond_to_synced_invitation(
    state: State<'_, DbState>,
    user_id: String,
    invitation_id: String,
    response: String,
) -> CommandResult<bool> {
    if !matches!(response.as_str(), "accept" | "decline") {
        return CommandResult::err("Choose accept or decline.");
    }
    let conn = match state.conn() {
        Ok(conn) => conn,
        Err(error) => return CommandResult::err(&format!("Database error: {error}")),
    };
    let (website_url, token, device_id, local_user_id) = match conn.query_row(
        "SELECT website_url, token, device_id, local_user_id FROM sync_state WHERE id = 1",
        [],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        },
    ) {
        Ok(config) => config,
        Err(_) => {
            return CommandResult::err("Pair the desktop app with the website before responding.");
        }
    };
    if local_user_id != user_id || website_url.is_empty() || token.is_empty() {
        return CommandResult::err("The signed-in account is not paired with the website.");
    }
    let response_body = match http_client()
        .post(format!(
            "{}/api/sync/invitations/respond",
            website_url.trim_end_matches('/')
        ))
        .header("Authorization", format!("Bearer {token}"))
        .header("X-Device-Id", device_id)
        .json(&json!({ "invitationId": invitation_id, "response": response }))
        .send()
    {
        Ok(response) => response,
        Err(error) => return CommandResult::err(&format!("Could not reach the website: {error}")),
    };
    if !response_body.status().is_success() {
        let message = response_body
            .json::<Value>()
            .ok()
            .and_then(|body| {
                body.get("error")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .unwrap_or_else(|| "The invitation response was rejected.".to_string());
        return CommandResult::err(&message);
    }
    let _ = conn.execute(
        "UPDATE synced_invitations SET status = ?1 WHERE id = ?2",
        params![
            if response == "accept" {
                "accepted"
            } else {
                "declined"
            },
            invitation_id
        ],
    );
    wake_sync();
    CommandResult::ok(true)
}

#[tauri::command]
pub fn manage_synced_event_members(
    state: State<'_, DbState>,
    user_id: String,
    event_id: String,
    action: String,
    member_id: Option<String>,
    role: Option<String>,
    email: Option<String>,
    invite_id: Option<String>,
) -> CommandResult<Value> {
    if !matches!(
        action.as_str(),
        "list"
            | "details"
            | "add"
            | "invite"
            | "resend"
            | "cancel-invitation"
            | "remove"
            | "change-role"
    ) {
        return CommandResult::err("Choose a valid member action.");
    }
    let conn = match state.conn() {
        Ok(conn) => conn,
        Err(error) => return CommandResult::err(&format!("Database error: {error}")),
    };
    let (website_url, token, device_id, local_user_id) = match conn.query_row(
        "SELECT website_url, token, device_id, local_user_id FROM sync_state WHERE id = 1",
        [],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        },
    ) {
        Ok(config) => config,
        Err(_) => {
            return CommandResult::err(
                "Pair the desktop app with the website before managing event members.",
            );
        }
    };
    if local_user_id != user_id || website_url.is_empty() || token.is_empty() {
        return CommandResult::err("The signed-in account is not paired with the website.");
    }
    let response = match http_client()
        .post(format!(
            "{}/api/sync/events/members",
            website_url.trim_end_matches('/')
        ))
        .header("Authorization", format!("Bearer {token}"))
        .header("X-Device-Id", device_id)
        .json(&json!({ "action": action, "eventId": event_id, "userId": member_id, "memberId": member_id, "role": role, "email": email, "inviteId": invite_id }))
        .send()
    {
        Ok(response) => response,
        Err(error) => return CommandResult::err(&format!("Could not reach the website: {error}")),
    };
    let status = response.status();
    let body = match response.json::<Value>() {
        Ok(body) => body,
        Err(_) => return CommandResult::err("The website response could not be read."),
    };
    if !status.is_success() {
        let message = body
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("Could not manage event members.");
        return CommandResult::err(message);
    }
    wake_sync();
    if action == "list" {
        let users = body.get("users").cloned().unwrap_or_else(|| json!([]));
        let users: Vec<AvailableEventUser> = match serde_json::from_value(users) {
            Ok(users) => users,
            Err(error) => {
                return CommandResult::err(&format!("Could not read available users: {error}"));
            }
        };
        return serde_json::to_value(users)
            .map(|value| CommandResult::ok(value))
            .unwrap_or_else(|error| {
                CommandResult::err(&format!("Could not format available users: {error}"))
            });
    }
    if action == "details" {
        return CommandResult::ok(body);
    }
    if action == "invite" || action == "resend" {
        return CommandResult::ok(body);
    }
    CommandResult::ok(json!(true))
}

#[tauri::command]
pub fn send_invitation(
    state: State<'_, DbState>,
    user_id: String,
    email: String,
) -> CommandResult<InvitationSendResult> {
    let email = email.trim().to_lowercase();
    if !email.contains('@') || email.chars().any(char::is_whitespace) {
        return CommandResult::err("Enter a valid email address.");
    }
    if email.is_empty() {
        return CommandResult::err("Enter an email address.");
    }

    let conn = match state.conn() {
        Ok(conn) => conn,
        Err(error) => return CommandResult::err(&format!("Database error: {error}")),
    };
    let (website_url, token, device_id, local_user_id) = match conn.query_row(
        "SELECT website_url, token, device_id, local_user_id FROM sync_state WHERE id = 1",
        [],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        },
    ) {
        Ok(config) => config,
        Err(_) => {
            return CommandResult::err(
                "Pair the desktop app with the website before inviting people.",
            );
        }
    };
    if local_user_id != user_id || website_url.is_empty() || token.is_empty() {
        return CommandResult::err("The signed-in account is not paired with the website.");
    }

    let response = match http_client()
        .post(format!(
            "{}/api/sync/workspace-invitations/send",
            website_url.trim_end_matches('/')
        ))
        .header("Authorization", format!("Bearer {token}"))
        .header("X-Device-Id", device_id)
        .json(&json!({ "email": email }))
        .send()
    {
        Ok(response) => response,
        Err(error) => return CommandResult::err(&format!("Could not reach the website: {error}")),
    };
    let status = response.status();
    let body = match response.json::<Value>() {
        Ok(body) => body,
        Err(_) => return CommandResult::err("The website response could not be read."),
    };
    if !status.is_success() {
        let message = body
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("The invitation could not be sent.");
        return CommandResult::err(message);
    }

    let result = InvitationSendResult {
        invite_url: body
            .get("inviteUrl")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        message: body
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("Invitation sent.")
            .to_string(),
    };
    wake_sync();
    CommandResult::ok(result)
}

#[tauri::command]
pub fn sync_get_config(state: State<'_, DbState>) -> CommandResult<SyncConfigInfo> {
    let conn = match state.conn() {
        Ok(c) => c,
        Err(e) => return CommandResult::err(&format!("Database error: {e}")),
    };
    CommandResult::ok(config_info(&conn))
}

#[tauri::command]
pub fn sync_manage_profile(
    state: State<'_, DbState>,
    action: String,
    name: Option<String>,
    mime_type: Option<String>,
    data_base64: Option<String>,
) -> CommandResult<Value> {
    let conn = match state.conn() {
        Ok(conn) => conn,
        Err(error) => return CommandResult::err(&format!("Database error: {error}")),
    };
    let Some(config) = load_config(&conn) else {
        return CommandResult::err(
            "Pair this desktop with the website to manage the online profile.",
        );
    };
    let mut body = json!({ "action": action });
    if let Some(name) = name {
        body["name"] = json!(name);
    }
    if let Some(mime_type) = mime_type {
        body["mimeType"] = json!(mime_type);
    }
    if let Some(data) = data_base64 {
        body["dataBase64"] = json!(data);
    }
    let response = match http_client()
        .post(format!(
            "{}/api/sync/profile",
            config.website_url.trim_end_matches('/')
        ))
        .header("Authorization", format!("Bearer {}", config.token))
        .json(&body)
        .send()
    {
        Ok(response) => response,
        Err(error) => return CommandResult::err(&format!("Could not reach the website: {error}")),
    };
    if response.status().as_u16() == 401 {
        return CommandResult::err("Sync token was rejected. Re-pair on the website.");
    }
    let status = response.status();
    let mut result: Value = match response.json() {
        Ok(value) => value,
        Err(error) => {
            return CommandResult::err(&format!("Website response could not be read: {error}"));
        }
    };
    if !status.is_success() {
        return CommandResult::err(
            result
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("Could not update profile."),
        );
    }
    if let Some(profile) = result.get_mut("profile").and_then(Value::as_object_mut) {
        if let Some(profile_name) = profile.get("name").and_then(Value::as_str) {
            let _ = conn.execute(
                "UPDATE users SET name=?1 WHERE id=?2",
                params![profile_name, config.local_user_id],
            );
        }
        if let Some(avatar) = profile.get("avatarUrl") {
            let absolute = avatar.as_str().map(|value| {
                if value.starts_with('/') {
                    format!("{}{}", config.website_url.trim_end_matches('/'), value)
                } else {
                    value.to_string()
                }
            });
            let _ = conn.execute(
                "UPDATE users SET avatar_url=?1 WHERE id=?2",
                params![absolute, config.local_user_id],
            );
            profile.insert("avatarUrl".into(), json!(absolute));
        }
    }
    CommandResult::ok(result)
}

#[tauri::command]
pub fn sync_get_calendar_feed(state: State<'_, DbState>, rotate: bool) -> CommandResult<String> {
    let conn = match state.conn() {
        Ok(conn) => conn,
        Err(error) => return CommandResult::err(&format!("Database error: {error}")),
    };
    let Some(config) = load_config(&conn) else {
        return CommandResult::err(
            "Pair this desktop with the website to access your calendar feed.",
        );
    };
    let suffix = if rotate { "?rotate=1" } else { "" };
    let response = match http_client()
        .get(format!(
            "{}/api/sync/calendar-feed{suffix}",
            config.website_url.trim_end_matches('/')
        ))
        .header("Authorization", format!("Bearer {}", config.token))
        .send()
    {
        Ok(response) => response,
        Err(error) => return CommandResult::err(&format!("Could not reach the website: {error}")),
    };
    if response.status().as_u16() == 401 {
        return CommandResult::err("Sync token was rejected. Re-pair on the website.");
    }
    let status = response.status();
    let body: Value = match response.json() {
        Ok(body) => body,
        Err(error) => {
            return CommandResult::err(&format!("Website response could not be read: {error}"));
        }
    };
    if !status.is_success() {
        return CommandResult::err(
            body.get("error")
                .and_then(Value::as_str)
                .unwrap_or("Could not load calendar feed."),
        );
    }
    let Some(path) = body.get("feedUrl").and_then(Value::as_str) else {
        return CommandResult::err("Website did not return a calendar feed URL.");
    };
    CommandResult::ok(
        if path.starts_with("http://") || path.starts_with("https://") {
            path.to_string()
        } else {
            format!("{}{}", config.website_url.trim_end_matches('/'), path)
        },
    )
}

/// Stores a pairing and seeds the outbox with existing local events so the
/// website receives everything the desktop already had. Shared by the manual
/// and auto-pairing flows.
fn activate_pairing(conn: &Connection, url: &str, token: &str, user_id: &str, account_email: &str) {
    let device_id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO sync_state (id, website_url, token, device_id, local_user_id, paired_account_email, last_pull_seq, last_sync_at, last_error)
         VALUES (1, ?1, ?2, ?3, ?4, ?5, 0, ?6, NULL)
         ON CONFLICT(id) DO UPDATE SET
           website_url = excluded.website_url,
           token = excluded.token,
           device_id = excluded.device_id,
           local_user_id = excluded.local_user_id,
           paired_account_email = excluded.paired_account_email,
           last_pull_seq = 0,
           last_sync_at = excluded.last_sync_at,
           last_error = NULL",
        params![url, token, device_id, user_id, account_email, now],
    )
    .ok();

    // Seed the outbox with existing local events so the website receives
    // everything the desktop already had.
    let existing: Vec<String> = {
        let mut stmt = match conn.prepare("SELECT id FROM events WHERE owner_id = ?1") {
            Ok(s) => s,
            Err(_) => return,
        };
        let rows = stmt.query_map(params![user_id], |row| row.get::<_, String>(0));
        match rows {
            Ok(rows) => rows.filter_map(|r| r.ok()).collect(),
            Err(_) => return,
        }
    };
    for event_id in existing {
        if let Some(payload) = event_payload(&conn, &event_id) {
            enqueue_event_change(&conn, "upsert", &payload);
        }
    }

    // Kick the loop so the seeded events reach the website immediately.
    wake_sync();
}

#[tauri::command]
pub fn sync_save_config(
    state: State<'_, DbState>,
    website_url: String,
    token: String,
    user_id: String,
) -> CommandResult<SyncConfigInfo> {
    let conn = match state.conn() {
        Ok(c) => c,
        Err(e) => return CommandResult::err(&format!("Database error: {e}")),
    };

    let url = website_url.trim().trim_end_matches('/').to_string();
    let token = token.trim().to_string();

    if url.is_empty() || !url.starts_with("http") {
        return CommandResult::err(
            "Enter the website address, e.g. https://eventmanager-5dsz.vercel.app",
        );
    }
    if token.len() < 16 {
        return CommandResult::err("Paste the pairing token from the website Settings page.");
    }
    if user_id.is_empty() {
        return CommandResult::err("Sign in to the desktop app first.");
    }

    // Verify the pairing before storing anything.
    let client = http_client();
    let response = client
        .post(format!("{url}/api/sync/verify"))
        .header("Authorization", format!("Bearer {token}"))
        .json(&json!({}))
        .send();

    let response = match response {
        Ok(r) => r,
        Err(e) => return CommandResult::err(&format!("Could not reach the website: {e}")),
    };

    if response.status().as_u16() == 401 {
        return CommandResult::err(
            "The website rejected this token. Generate a new pairing token on the Settings page.",
        );
    }
    if !response.status().is_success() {
        return CommandResult::err(&format!(
            "The website returned HTTP {} while verifying.",
            response.status()
        ));
    }

    let body: Value = match response.json() {
        Ok(b) => b,
        Err(_) => return CommandResult::err("The website response could not be read."),
    };
    let account_email = body
        .pointer("/user/email")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();

    activate_pairing(&conn, &url, &token, &user_id, &account_email);

    CommandResult::ok(config_info(&conn))
}

/// Zero-UI pairing: called automatically after a successful desktop sign-in.
/// The password is used once to authenticate against the website and is never
/// stored; the returned device token is what gets saved locally.
#[tauri::command]
pub fn sync_auto_pair(
    state: State<'_, DbState>,
    email: String,
    password: String,
    user_id: String,
) -> CommandResult<SyncConfigInfo> {
    let conn = match state.conn() {
        Ok(c) => c,
        Err(e) => return CommandResult::err(&format!("Database error: {e}")),
    };

    // Already paired to this same account? Nothing to do.
    if let Some(existing) = load_config(&conn) {
        if existing.local_user_id == user_id && !existing.website_url.is_empty() {
            return CommandResult::ok(config_info(&conn));
        }
    }

    if email.trim().is_empty() || password.is_empty() || user_id.is_empty() {
        return CommandResult::err("Sign in to enable website sync.");
    }

    let client = http_client();
    let response = match client
        .post(format!("{DEFAULT_WEBSITE_URL}/api/sync/auto-pair"))
        .json(&json!({ "email": email, "password": password }))
        .send()
    {
        Ok(r) => r,
        Err(e) => {
            return CommandResult::err(&format!("Could not reach the website to enable sync: {e}"));
        }
    };

    if response.status().as_u16() == 401 {
        return CommandResult::err("Email or password is incorrect.");
    }
    if response.status().as_u16() == 429 {
        return CommandResult::err("Too many sync attempts. Try again later.");
    }
    if !response.status().is_success() {
        return CommandResult::err(&format!(
            "The website returned HTTP {} while enabling sync.",
            response.status()
        ));
    }

    let body: Value = match response.json() {
        Ok(b) => b,
        Err(_) => return CommandResult::err("The website response could not be read."),
    };

    let Some(token) = body.get("token").and_then(Value::as_str) else {
        return CommandResult::err("The website did not return a sync token.");
    };
    let account_email = body
        .pointer("/user/email")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();

    if !account_email.eq_ignore_ascii_case(email.trim()) {
        return CommandResult::err(
            "The website signed in a different account. Use the same email for desktop and website.",
        );
    }

    activate_pairing(&conn, DEFAULT_WEBSITE_URL, token, &user_id, &account_email);

    CommandResult::ok(config_info(&conn))
}

#[tauri::command]
pub fn sync_disconnect(state: State<'_, DbState>) -> CommandResult<bool> {
    let conn = match state.conn() {
        Ok(c) => c,
        Err(e) => return CommandResult::err(&format!("Database error: {e}")),
    };

    conn.execute("DELETE FROM sync_state WHERE id = 1", [])
        .map_err(|e| format!("Database error: {e}"))
        .ok();
    conn.execute("DELETE FROM sync_outbox", []).ok();

    CommandResult::ok(true)
}

/// Runs one sync cycle on demand (used by the "Sync now" button).
#[tauri::command]
pub fn sync_now(app: AppHandle) -> CommandResult<usize> {
    match run_cycle(&app) {
        Ok(applied) => {
            if applied > 0 {
                let _ = app.emit("sync-applied", applied);
            }
            CommandResult::ok(applied)
        }
        Err(e) => CommandResult::err(&e),
    }
}
