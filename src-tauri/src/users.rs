use crate::db::DbState;
use crate::types::{CommandResult, UserRecord};
use rusqlite::params;
use serde_json::{Value, json};
use tauri::State;

#[tauri::command]
pub fn list_users(state: State<'_, DbState>, user_id: String) -> CommandResult<Vec<UserRecord>> {
    let conn = match state.conn() {
        Ok(c) => c,
        Err(e) => return CommandResult::err(&format!("Database error: {e}")),
    };

    let role = conn.query_row(
        "SELECT workspace_role FROM users WHERE id=?1",
        params![user_id],
        |row| row.get::<_, String>(0),
    );
    match role {
        Ok(role) if role == "owner" || role == "admin" => {}
        Ok(_) => return CommandResult::err("Only workspace administrators can view users."),
        Err(rusqlite::Error::QueryReturnedNoRows) => return CommandResult::err("User not found."),
        Err(e) => return CommandResult::err(&format!("Database error: {e}")),
    }

    let mut stmt = match conn.prepare(
        "SELECT id, name, email, provider, avatar_url, workspace_role, created_at FROM users ORDER BY created_at DESC",
    ) {
        Ok(s) => s,
        Err(e) => return CommandResult::err(&format!("Database error: {e}")),
    };

    let rows = stmt.query_map(params![], |row| {
        Ok(UserRecord {
            id: row.get(0)?,
            name: row.get(1)?,
            email: row.get(2)?,
            provider: row.get(3)?,
            avatar_url: row.get(4)?,
            workspace_role: row.get(5)?,
            created_at: row.get(6)?,
        })
    });

    let mut users = Vec::new();
    match rows {
        Ok(rows) => {
            for row in rows {
                match row {
                    Ok(user) => users.push(user),
                    Err(e) => return CommandResult::err(&format!("Database error: {e}")),
                }
            }
        }
        Err(e) => return CommandResult::err(&format!("Database error: {e}")),
    }

    CommandResult::ok(users)
}

#[tauri::command]
pub fn manage_workspace_users(
    state: State<'_, DbState>,
    user_id: String,
    action: String,
    target_user_id: Option<String>,
    name: Option<String>,
    email: Option<String>,
    password: Option<String>,
    role: Option<String>,
) -> CommandResult<Value> {
    let conn = match state.conn() {
        Ok(conn) => conn,
        Err(error) => return CommandResult::err(&format!("Database error: {error}")),
    };
    let config = conn.query_row(
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
    );
    let (website_url, token, device_id, local_user_id) = match config {
        Ok(config) => config,
        Err(_) => {
            return CommandResult::err(
                "Pair the desktop app with the website before managing workspace users.",
            );
        }
    };
    if local_user_id != user_id || website_url.is_empty() || token.is_empty() {
        return CommandResult::err("The signed-in account is not paired with the website.");
    }

    let client = match reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            return CommandResult::err(&format!(
                "Could not initialize the website connection: {error}"
            ));
        }
    };
    let response = client
        .post(format!(
            "{}/api/sync/users",
            website_url.trim_end_matches('/')
        ))
        .header("Authorization", format!("Bearer {token}"))
        .header("X-Device-Id", device_id)
        .json(&json!({
            "action": action,
            "userId": target_user_id,
            "name": name,
            "email": email,
            "password": password,
            "role": role,
        }))
        .send();
    let response = match response {
        Ok(response) => response,
        Err(error) => return CommandResult::err(&format!("Could not reach the website: {error}")),
    };
    let status = response.status();
    let body = match response.json::<Value>() {
        Ok(body) => body,
        Err(_) => return CommandResult::err("The website response could not be read."),
    };
    if !status.is_success() {
        return CommandResult::err(
            body.get("error")
                .and_then(Value::as_str)
                .unwrap_or("Could not manage workspace users."),
        );
    }
    let result = if action == "list" {
        body.get("users").cloned().unwrap_or_else(|| json!([]))
    } else {
        json!(true)
    };
    match serde_json::from_value::<Value>(result) {
        Ok(value) => CommandResult::ok(value),
        Err(error) => CommandResult::err(&format!("Could not read workspace users: {error}")),
    }
}
