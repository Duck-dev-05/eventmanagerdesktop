use crate::db::DbState;
use crate::sync::enqueue_notification_read;
use crate::types::{CommandResult, Notification};
use rusqlite::params;
use tauri::State;

#[tauri::command]
pub fn list_notifications(
    state: State<'_, DbState>,
    user_id: String,
) -> CommandResult<Vec<Notification>> {
    let conn = match state.conn() {
        Ok(c) => c,
        Err(e) => return CommandResult::err(&format!("Database error: {e}")),
    };

    let mut stmt = match conn.prepare(
        "SELECT id, event_id, kind, title, message, link_url, read_at, created_at
         FROM event_notifications
         WHERE user_id = ?1
         ORDER BY created_at DESC
         LIMIT 50",
    ) {
        Ok(s) => s,
        Err(e) => return CommandResult::err(&format!("Database error: {e}")),
    };

    let rows = stmt.query_map(params![user_id], |row| {
        Ok(Notification {
            id: row.get(0)?,
            event_id: row.get(1)?,
            kind: row.get(2)?,
            title: row.get(3)?,
            message: row.get(4)?,
            link_url: row.get(5)?,
            read_at: row.get(6)?,
            created_at: row.get(7)?,
        })
    });

    let mut notifications = Vec::new();
    match rows {
        Ok(rows) => {
            for row in rows {
                match row {
                    Ok(notification) => notifications.push(notification),
                    Err(e) => return CommandResult::err(&format!("Database error: {e}")),
                }
            }
        }
        Err(e) => return CommandResult::err(&format!("Database error: {e}")),
    }

    CommandResult::ok(notifications)
}

#[tauri::command]
pub fn mark_notification_read(
    state: State<'_, DbState>,
    user_id: String,
    notification_id: String,
) -> CommandResult<bool> {
    let conn = match state.conn() {
        Ok(c) => c,
        Err(e) => return CommandResult::err(&format!("Database error: {e}")),
    };
    match conn.execute(
        "UPDATE event_notifications SET read_at = ?1 WHERE id = ?2 AND user_id = ?3 AND read_at IS NULL",
        params![chrono::Utc::now().to_rfc3339(), notification_id, user_id],
    ) {
        Ok(_) => match enqueue_notification_read(&conn, &user_id, Some(&notification_id), false) {
            Ok(()) => CommandResult::ok(true),
            Err(e) => CommandResult::err(&format!("Could not queue notification sync: {e}")),
        }
        Err(e) => CommandResult::err(&format!("Could not mark notification as read: {e}")),
    }
}

#[tauri::command]
pub fn mark_all_notifications_read(
    state: State<'_, DbState>,
    user_id: String,
) -> CommandResult<bool> {
    let conn = match state.conn() {
        Ok(c) => c,
        Err(e) => return CommandResult::err(&format!("Database error: {e}")),
    };
    match conn.execute(
        "UPDATE event_notifications SET read_at = ?1 WHERE user_id = ?2 AND read_at IS NULL",
        params![chrono::Utc::now().to_rfc3339(), user_id],
    ) {
        Ok(_) => match enqueue_notification_read(&conn, &user_id, None, true) {
            Ok(()) => CommandResult::ok(true),
            Err(e) => CommandResult::err(&format!("Could not queue notification sync: {e}")),
        },
        Err(e) => CommandResult::err(&format!("Could not mark notifications as read: {e}")),
    }
}

#[tauri::command]
pub fn get_unread_notification_count(
    state: State<'_, DbState>,
    user_id: String,
) -> CommandResult<i32> {
    let conn = match state.conn() {
        Ok(c) => c,
        Err(e) => return CommandResult::err(&format!("Database error: {e}")),
    };

    let stmt = conn
        .prepare("SELECT COUNT(*) FROM event_notifications WHERE user_id = ?1 AND read_at IS NULL")
        .ok();
    let count: i32 = match stmt {
        Some(mut s) => s.query_row(params![user_id], |row| row.get(0)).unwrap_or(0),
        None => 0,
    };

    CommandResult::ok(count)
}
