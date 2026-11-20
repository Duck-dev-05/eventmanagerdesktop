use crate::db::DbState;
use crate::types::{CommandResult, PreferenceRecord, UpdatePreferenceInput};
use chrono::Utc;
use rusqlite::params;
use serde_json::json;
use tauri::State;

#[tauri::command]
pub fn get_preferences(
    state: State<'_, DbState>,
    user_id: String,
) -> CommandResult<PreferenceRecord> {
    let conn = match state.conn() {
        Ok(c) => c,
        Err(e) => return CommandResult::err(&format!("Database error: {e}")),
    };

    let stmt = conn.prepare("SELECT user_id, event_reminders, email_updates, weekly_digest, default_capacity, updated_at FROM user_preferences WHERE user_id = ?1").ok();

    let row = match stmt {
        Some(mut stmt) => stmt.query_row(params![user_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i32>(1)?,
                row.get::<_, i32>(2)?,
                row.get::<_, i32>(3)?,
                row.get::<_, Option<i32>>(4)?,
                row.get::<_, String>(5)?,
            ))
        }),
        None => {
            return CommandResult::ok(PreferenceRecord {
                user_id,
                event_reminders: true,
                email_updates: true,
                weekly_digest: false,
                default_capacity: None,
                updated_at: Utc::now().to_rfc3339(),
            });
        }
    };

    let (user_id, reminders, updates, digest, capacity, updated_at) = match row {
        Ok((user_id, reminders, updates, digest, capacity, updated_at)) => {
            (user_id, reminders, updates, digest, capacity, updated_at)
        }
        Err(_) => {
            return CommandResult::ok(PreferenceRecord {
                user_id,
                event_reminders: true,
                email_updates: true,
                weekly_digest: false,
                default_capacity: None,
                updated_at: Utc::now().to_rfc3339(),
            });
        }
    };

    CommandResult::ok(PreferenceRecord {
        user_id,
        event_reminders: reminders != 0,
        email_updates: updates != 0,
        weekly_digest: digest != 0,
        default_capacity: capacity,
        updated_at,
    })
}

#[tauri::command]
pub fn update_preferences(
    state: State<'_, DbState>,
    user_id: String,
    input: UpdatePreferenceInput,
) -> CommandResult<PreferenceRecord> {
    let conn = match state.conn() {
        Ok(c) => c,
        Err(e) => return CommandResult::err(&format!("Database error: {e}")),
    };

    if input
        .default_capacity
        .is_some_and(|capacity| !(1..=100_000).contains(&capacity))
    {
        return CommandResult::err(
            "Default capacity must be a whole number between 1 and 100,000, or empty for no limit.",
        );
    }

    let now = Utc::now().to_rfc3339();

    let result = conn.execute(
        "INSERT INTO user_preferences (user_id, event_reminders, email_updates, weekly_digest, default_capacity, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(user_id) DO UPDATE SET
           event_reminders = excluded.event_reminders,
           email_updates = excluded.email_updates,
           weekly_digest = excluded.weekly_digest,
           default_capacity = excluded.default_capacity,
           updated_at = excluded.updated_at",
        params![
            user_id,
            input.event_reminders.unwrap_or(true) as i32,
            input.email_updates.unwrap_or(true) as i32,
            input.weekly_digest.unwrap_or(false) as i32,
            input.default_capacity,
            now,
        ],
    );
    if let Err(error) = result {
        return CommandResult::err(&format!("Could not save preferences: {error}"));
    }

    let payload = json!({
        "eventReminders": input.event_reminders.unwrap_or(true),
        "emailUpdates": input.email_updates.unwrap_or(true),
        "weeklyDigest": input.weekly_digest.unwrap_or(false),
        "defaultCapacity": input.default_capacity,
    });
    if let Err(error) = conn.execute(
        "INSERT INTO sync_preferences_outbox (user_id,payload,updated_at) VALUES (?1,?2,?3)
         ON CONFLICT(user_id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at",
        params![user_id, payload.to_string(), now],
    ) {
        return CommandResult::err(&format!("Could not queue preferences for sync: {error}"));
    }
    crate::sync::wake_sync();

    CommandResult::ok(PreferenceRecord {
        user_id,
        event_reminders: input.event_reminders.unwrap_or(true),
        email_updates: input.email_updates.unwrap_or(true),
        weekly_digest: input.weekly_digest.unwrap_or(false),
        default_capacity: input.default_capacity,
        updated_at: now,
    })
}
