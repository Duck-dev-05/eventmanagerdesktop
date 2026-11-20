use crate::crypto::{hash_password, verify_password};
use crate::db::DbState;
use crate::types::{CommandResult, SessionUser};
use rusqlite::params;
use tauri::State;

#[tauri::command]
pub fn sign_in(
    state: State<'_, DbState>,
    email: String,
    password: String,
) -> CommandResult<SessionUser> {
    let conn = match state.conn() {
        Ok(c) => c,
        Err(e) => return CommandResult::err(&format!("Database error: {e}")),
    };

    let stmt = conn.prepare(
        "SELECT id, name, email, password_hash, avatar_url, workspace_role FROM users WHERE email = ?1 AND provider = 'password'",
    ).ok();

    let row = match stmt {
        Some(mut stmt) => stmt.query_row(params![email], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                row.get::<_, Option<String>>(4)?,
                row.get::<_, String>(5)?,
            ))
        }),
        None => return CommandResult::err("Email or password is incorrect."),
    };

    let (id, name, email_val, password_hash_val, avatar_url, role) = match row {
        Ok((id, name, email_val, password_hash_val, avatar_url, role)) => {
            (id, name, email_val, password_hash_val, avatar_url, role)
        }
        Err(_) => return CommandResult::err("Email or password is incorrect."),
    };

    // Check the website first for paired accounts so a password reset can
    // replace an outdated local hash. Keep offline sign-in available when the
    // website cannot be reached.
    if crate::sync::is_paired_user(&conn, &id) {
        match crate::sync::verify_website_credentials(&conn, &email_val, &password) {
            Ok(true) => {
                let upgraded_hash = hash_password(&password);
                if let Err(error) = conn.execute(
                    "UPDATE users SET password_hash=?1 WHERE id=?2",
                    params![upgraded_hash, id],
                ) {
                    return CommandResult::err(&format!(
                        "Could not update cached credentials: {error}"
                    ));
                }
                return CommandResult::ok(SessionUser {
                    id,
                    name,
                    email: email_val,
                    avatar_url,
                    workspace_role: role,
                });
            }
            Ok(false) => return CommandResult::err("Email or password is incorrect."),
            Err(error) if error.starts_with("Too many password attempts") => {
                return CommandResult::err(&error);
            }
            Err(_) => {} // Network unavailable; try the locally cached credential.
        }
    }

    if password_hash_val.is_empty() || !verify_password(&password, &password_hash_val) {
        return CommandResult::err("Email or password is incorrect.");
    }

    CommandResult::ok(SessionUser {
        id,
        name,
        email: email_val,
        avatar_url,
        workspace_role: role,
    })
}

#[tauri::command]
pub fn sign_up(
    state: State<'_, DbState>,
    name: String,
    email: String,
    password: String,
) -> CommandResult<SessionUser> {
    let conn = match state.conn() {
        Ok(c) => c,
        Err(e) => return CommandResult::err(&format!("Database error: {e}")),
    };

    let exists = match conn.query_row(
        "SELECT 1 FROM users WHERE email = ?1 COLLATE NOCASE LIMIT 1",
        params![email],
        |_| Ok(true),
    ) {
        Ok(true) => true,
        Ok(false) | Err(rusqlite::Error::QueryReturnedNoRows) => false,
        Err(error) => return CommandResult::err(&format!("Database error: {error}")),
    };

    if exists {
        return CommandResult::err("An account with this email already exists.");
    }
    if password.chars().count() < 8 {
        return CommandResult::err("Password must be at least 8 characters.");
    }

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let password_hash = hash_password(&password);

    let count: i32 = match conn.query_row("SELECT COUNT(*) FROM users", [], |row| row.get(0)) {
        Ok(count) => count,
        Err(error) => return CommandResult::err(&format!("Database error: {error}")),
    };
    let role = if count == 0 { "owner" } else { "member" };

    if let Err(error) = conn.execute(
        "INSERT INTO users (id, name, email, provider, password_hash, workspace_role, created_at) VALUES (?1, ?2, ?3, 'password', ?4, ?5, ?6)",
        params![id, name, email, password_hash, role, now],
    ) {
        return CommandResult::err(&format!("Could not create account: {error}"));
    }

    if let Err(error) = conn.execute(
        "INSERT INTO user_preferences (user_id, event_reminders, email_updates, weekly_digest, updated_at) VALUES (?1, 1, 1, 0, ?2)",
        params![id, now],
    ) {
        let _ = conn.execute("DELETE FROM users WHERE id = ?1", params![id]);
        return CommandResult::err(&format!("Could not initialize account preferences: {error}"));
    }

    CommandResult::ok(SessionUser {
        id,
        name,
        email,
        avatar_url: None,
        workspace_role: role.to_string(),
    })
}

#[tauri::command]
pub fn update_profile(
    state: State<'_, DbState>,
    user_id: String,
    name: String,
) -> CommandResult<SessionUser> {
    let conn = match state.conn() {
        Ok(c) => c,
        Err(e) => return CommandResult::err(&format!("Database error: {e}")),
    };
    let name = name.split_whitespace().collect::<Vec<_>>().join(" ");
    if name.len() < 2 || name.len() > 80 {
        return CommandResult::err("Display name must be between 2 and 80 characters.");
    }
    match conn.execute(
        "UPDATE users SET name=?1 WHERE id=?2",
        params![name, user_id],
    ) {
        Ok(0) => CommandResult::err("User not found."),
        Err(e) => CommandResult::err(&format!("Could not update profile: {e}")),
        Ok(_) => get_current_user(state, user_id),
    }
}

#[tauri::command]
pub fn sign_out() -> CommandResult<bool> {
    CommandResult::ok(true)
}

#[tauri::command]
pub fn get_current_user(state: State<'_, DbState>, user_id: String) -> CommandResult<SessionUser> {
    let conn = match state.conn() {
        Ok(c) => c,
        Err(e) => return CommandResult::err(&format!("Database error: {e}")),
    };

    let stmt = conn
        .prepare("SELECT id, name, email, avatar_url, workspace_role FROM users WHERE id = ?1")
        .ok();

    let row = match stmt {
        Some(mut stmt) => stmt.query_row(params![user_id], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
            ))
        }),
        None => return CommandResult::err("User not found."),
    };

    let (id, name, email, avatar_url, role) = match row {
        Ok((id, name, email, avatar_url, role)) => (id, name, email, avatar_url, role),
        Err(_) => return CommandResult::err("User not found."),
    };

    CommandResult::ok(SessionUser {
        id,
        name,
        email,
        avatar_url,
        workspace_role: role,
    })
}
