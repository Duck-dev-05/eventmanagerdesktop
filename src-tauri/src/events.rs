use crate::db::DbState;
use crate::sync::{enqueue_event_change, event_payload};
use crate::types::{
    ActivityEntry, CommandResult, CreateEventInput, EventListItem, EventRecord, LogActivityInput,
    UpdateEventInput,
};
use chrono::{Datelike, Utc};
use rusqlite::{Connection, OptionalExtension, params};
use tauri::State;
use uuid::Uuid;

pub(crate) fn event_role(
    conn: &Connection,
    event_id: &str,
    user_id: &str,
) -> rusqlite::Result<Option<String>> {
    let owner_id: Option<String> = conn
        .query_row(
            "SELECT owner_id FROM events WHERE id = ?1",
            params![event_id],
            |row| row.get(0),
        )
        .optional()?;
    if owner_id.as_deref() == Some(user_id) {
        return Ok(Some("owner".to_string()));
    }
    conn.query_row(
        "SELECT role FROM event_members WHERE event_id=?1 AND user_id=?2 AND status='accepted'
         UNION ALL
         SELECT role FROM synced_event_members WHERE event_id=?1 AND user_id=?2 AND status='accepted'
         LIMIT 1",
        params![event_id, user_id],
        |row| row.get(0),
    )
    .optional()
}

pub(crate) fn can_view_event(
    conn: &Connection,
    event_id: &str,
    user_id: &str,
) -> rusqlite::Result<bool> {
    Ok(event_role(conn, event_id, user_id)?.is_some()
        || conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM events WHERE id=?1 AND visibility='public')",
            params![event_id],
            |row| row.get(0),
        )?)
}

#[tauri::command]
pub fn list_events(state: State<'_, DbState>, user_id: String) -> CommandResult<Vec<EventRecord>> {
    let conn = match state.conn() {
        Ok(c) => c,
        Err(e) => return CommandResult::err(&format!("Database error: {e}")),
    };

    let mut stmt = match conn.prepare(
        "SELECT e.id, e.owner_id, e.title, e.description, e.category, e.venue, e.starts_at, e.capacity, e.visibility, e.created_at FROM events e
         WHERE e.owner_id = ?1
           OR e.id IN (SELECT event_id FROM event_members WHERE user_id = ?2 AND status = 'accepted')
           OR e.id IN (SELECT event_id FROM synced_event_members WHERE user_id = ?2 AND status = 'accepted')
         ORDER BY e.starts_at DESC",
    ) {
        Ok(s) => s,
        Err(e) => return CommandResult::err(&format!("Database error: {e}")),
    };

    let rows = stmt.query_map(params![user_id.clone(), user_id], |row| {
        Ok(EventRecord {
            id: row.get(0)?,
            owner_id: row.get(1)?,
            title: row.get(2)?,
            description: row.get(3)?,
            category: row.get(4)?,
            venue: row.get(5)?,
            starts_at: row.get(6)?,
            capacity: row.get::<_, Option<i32>>(7)?,
            visibility: row.get(8)?,
            created_at: row.get(9)?,
        })
    });

    let mut events = Vec::new();
    match rows {
        Ok(rows) => {
            for row in rows {
                match row {
                    Ok(event) => events.push(event),
                    Err(e) => return CommandResult::err(&format!("Database error: {e}")),
                }
            }
        }
        Err(e) => return CommandResult::err(&format!("Database error: {e}")),
    }

    CommandResult::ok(events)
}

#[tauri::command]
pub fn list_events_flat(
    state: State<'_, DbState>,
    user_id: String,
) -> CommandResult<Vec<EventListItem>> {
    let conn = match state.conn() {
        Ok(c) => c,
        Err(e) => return CommandResult::err(&format!("Database error: {e}")),
    };

    let mut stmt = match conn.prepare(
        "SELECT e.id, e.owner_id, e.title, e.starts_at, e.venue, e.capacity,
                ((SELECT COUNT(*) FROM event_members em WHERE em.event_id = e.id AND em.user_id = ?2 AND em.status = 'accepted')
                 + (SELECT COUNT(*) FROM synced_event_members sm WHERE sm.event_id = e.id AND sm.user_id = ?2 AND sm.status = 'accepted')) > 0 AS is_member
         FROM events e
         WHERE e.owner_id = ?1
            OR e.id IN (SELECT event_id FROM event_members WHERE user_id = ?2 AND status = 'accepted')
            OR e.id IN (SELECT event_id FROM synced_event_members WHERE user_id = ?2 AND status = 'accepted')
         ORDER BY e.starts_at DESC",
    ) {
        Ok(s) => s,
        Err(e) => return CommandResult::err(&format!("Database error: {e}")),
    };

    let rows = stmt.query_map(params![user_id.clone(), user_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, String>(4)?,
            row.get::<_, Option<i32>>(5)?,
            row.get::<_, bool>(6)?,
        ))
    });

    let mut items = Vec::new();
    match rows {
        Ok(rows) => {
            for row in rows {
                match row {
                    Ok((id, owner_id, title, starts_at, venue, capacity, is_member)) => {
                        let dt = chrono::DateTime::parse_from_rfc3339(&starts_at)
                            .map(|d| d.with_timezone(&Utc))
                            .unwrap_or(Utc::now());
                        let status = if dt < Utc::now() { "Past" } else { "Upcoming" };

                        items.push(EventListItem {
                            id,
                            title,
                            month: dt.format("%b").to_string(),
                            day: dt.day().to_string(),
                            time: dt.format("%H:%M").to_string(),
                            venue: if venue.is_empty() {
                                "Location to be announced".into()
                            } else {
                                venue
                            },
                            capacity,
                            status: status.to_string(),
                            is_owner: owner_id == user_id || !is_member,
                        });
                    }
                    Err(e) => return CommandResult::err(&format!("Database error: {e}")),
                }
            }
        }
        Err(e) => return CommandResult::err(&format!("Database error: {e}")),
    }

    CommandResult::ok(items)
}

#[tauri::command]
pub fn create_event(
    state: State<'_, DbState>,
    user_id: String,
    input: CreateEventInput,
) -> CommandResult<EventRecord> {
    let conn = match state.conn() {
        Ok(c) => c,
        Err(e) => return CommandResult::err(&format!("Database error: {e}")),
    };

    let title = input.title.trim().to_string();
    if title.chars().count() < 3 || title.chars().count() > 160 {
        return CommandResult::err("Event title must be between 3 and 160 characters.");
    }
    let capacity = match input.capacity {
        Some(capacity) if capacity < 1 => {
            return CommandResult::err("Capacity must be a whole number above 0.");
        }
        capacity => capacity,
    };
    if chrono::DateTime::parse_from_rfc3339(&input.starts_at).is_err() {
        return CommandResult::err("Enter a valid event date and time.");
    }
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    if let Err(error) = conn.execute(
        "INSERT INTO events (id, owner_id, title, description, category, venue, starts_at, capacity, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            id, user_id, title, input.description, input.category,
            input.venue, input.starts_at, capacity, now,
        ],
    ) {
        return CommandResult::err(&format!("Could not create event: {error}"));
    }

    // Hand the new event to the website on the next sync cycle.
    if let Some(payload) = event_payload(&conn, &id) {
        enqueue_event_change(&conn, "upsert", &payload);
    }

    let _ = conn.execute(
        "INSERT INTO event_activity (id, event_id, actor_id, kind, summary, created_at)
         VALUES (?1, ?2, ?3, 'event', ?4, ?5)",
        params![
            Uuid::new_v4().to_string(),
            id,
            user_id,
            format!("{} created the event", title),
            now,
        ],
    );

    CommandResult::ok(EventRecord {
        id,
        owner_id: user_id,
        title,
        description: input.description,
        category: input.category,
        venue: input.venue,
        starts_at: input.starts_at,
        capacity,
        visibility: "private".to_string(),
        created_at: now,
    })
}

#[tauri::command]
pub fn update_event(
    state: State<'_, DbState>,
    event_id: String,
    actor_id: String,
    input: UpdateEventInput,
) -> CommandResult<bool> {
    let conn = match state.conn() {
        Ok(c) => c,
        Err(e) => return CommandResult::err(&format!("Database error: {e}")),
    };

    let role = match event_role(&conn, &event_id, &actor_id) {
        Ok(Some(role)) => role,
        Ok(None) => return CommandResult::err("You do not have access to this event."),
        Err(error) => return CommandResult::err(&format!("Database error: {error}")),
    };
    if role != "owner" && role != "admin" {
        return CommandResult::err("Only the event owner and admins can update the event.");
    }
    let title = input.title.trim();
    let title_length = title.chars().count();
    if !(3..=160).contains(&title_length) {
        return CommandResult::err("Event title must be between 3 and 160 characters.");
    }
    if input.visibility != "public" && input.visibility != "private" {
        return CommandResult::err("Choose a valid event visibility.");
    }
    if input.capacity.is_some_and(|capacity| capacity < 1) {
        return CommandResult::err("Capacity must be a whole number above 0.");
    }
    if chrono::DateTime::parse_from_rfc3339(&input.starts_at).is_err() {
        return CommandResult::err("Enter a valid event date and time.");
    }

    let updated = match conn.execute(
        "UPDATE events SET title = ?1, description = ?2, category = ?3, venue = ?4, starts_at = ?5, capacity = ?6, visibility = ?7 WHERE id = ?8",
        params![
            title, input.description, input.category, input.venue,
            input.starts_at, input.capacity, input.visibility, event_id
        ],
    ) {
        Ok(updated) => updated,
        Err(error) => return CommandResult::err(&format!("Could not update event: {error}")),
    };

    if updated == 0 {
        return CommandResult::err("Event not found.");
    }

    // Hand the update to the website on the next sync cycle.
    if let Some(payload) = event_payload(&conn, event_id.as_str()) {
        enqueue_event_change(&conn, "upsert", &payload);
    }

    let _ = conn.execute(
        "INSERT INTO event_activity (id, event_id, actor_id, kind, summary, created_at)
         VALUES (?1, ?2, ?3, 'event', ?4, ?5)",
        params![
            Uuid::new_v4().to_string(),
            event_id,
            actor_id,
            "updated the event details",
            Utc::now().to_rfc3339(),
        ],
    );

    CommandResult::ok(true)
}

#[tauri::command]
pub fn duplicate_event(
    state: State<'_, DbState>,
    event_id: String,
    actor_id: String,
    title: String,
    starts_at: String,
) -> CommandResult<EventRecord> {
    let conn = match state.conn() {
        Ok(c) => c,
        Err(e) => return CommandResult::err(&format!("Database error: {e}")),
    };
    let title = title.trim();
    if title.chars().count() < 3 || title.chars().count() > 160 {
        return CommandResult::err("Event title must be between 3 and 160 characters.");
    }
    let new_start = match chrono::DateTime::parse_from_rfc3339(&starts_at) {
        Ok(value) => value.with_timezone(&Utc),
        Err(_) => return CommandResult::err("Enter a valid event date and time."),
    };
    let original: Option<(String, String, String, String, String, String, Option<i32>, String, String)> = conn
        .query_row(
            "SELECT owner_id,title,description,category,venue,starts_at,capacity,visibility,created_at FROM events WHERE id=?1",
            params![event_id],
            |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?,row.get(5)?,row.get(6)?,row.get(7)?,row.get(8)?)),
        )
        .optional()
        .unwrap_or(None);
    let Some((owner_id, _, description, category, venue, original_start, capacity, visibility, _)) =
        original
    else {
        return CommandResult::err("Event not found.");
    };
    if owner_id != actor_id {
        return CommandResult::err("Only the event owner can duplicate this event.");
    }
    let old_start = match chrono::DateTime::parse_from_rfc3339(&original_start) {
        Ok(value) => value.with_timezone(&Utc),
        Err(_) => return CommandResult::err("The original event has an invalid date."),
    };
    let shift = new_start.signed_duration_since(old_start);
    let new_event_id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let tx = match conn.unchecked_transaction() {
        Ok(tx) => tx,
        Err(error) => return CommandResult::err(&format!("Could not start duplication: {error}")),
    };
    if let Err(error) = tx.execute(
        "INSERT INTO events (id,owner_id,title,description,category,venue,starts_at,capacity,visibility,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
        params![new_event_id,actor_id,title,description,category,venue,new_start.to_rfc3339(),capacity,visibility,now],
    ) {
        return CommandResult::err(&format!("Could not duplicate event: {error}"));
    }
    let copy_tasks = tx.execute(
        "INSERT INTO event_tasks (id,event_id,title,notes,status,assignee_id,due_at,created_by,created_at)
         SELECT lower(hex(randomblob(16))),?1,title,notes,'open',NULL,
           CASE WHEN due_at IS NULL THEN NULL ELSE strftime('%Y-%m-%dT%H:%M:%fZ', julianday(due_at) + ?2) END,
           ?3,?4 FROM event_tasks WHERE event_id=?5",
        params![new_event_id, shift.num_seconds() as f64 / 86_400.0, actor_id, now, event_id],
    );
    if let Err(error) = copy_tasks {
        return CommandResult::err(&format!("Could not duplicate event tasks: {error}"));
    }
    let copy_agenda = tx.execute(
        "INSERT INTO event_agenda_items (id,event_id,title,description,starts_at,duration_minutes,location,speaker_name,status,sort_order,created_at)
         SELECT lower(hex(randomblob(16))),?1,title,description,
           strftime('%Y-%m-%dT%H:%M:%fZ', julianday(starts_at) + ?2),
           duration_minutes,location,speaker_name,'scheduled',sort_order,?3
         FROM event_agenda_items WHERE event_id=?4",
        params![new_event_id, shift.num_seconds() as f64 / 86_400.0, now, event_id],
    );
    if let Err(error) = copy_agenda {
        return CommandResult::err(&format!("Could not duplicate event schedule: {error}"));
    }
    if let Err(error) = tx.commit() {
        return CommandResult::err(&format!("Could not finish event duplication: {error}"));
    }
    if let Some(payload) = event_payload(&conn, &new_event_id) {
        enqueue_event_change(&conn, "upsert", &payload);
    }
    let _ = conn.execute(
        "INSERT INTO event_activity (id,event_id,actor_id,kind,summary,created_at) VALUES (?1,?2,?3,'event',?4,?5)",
        params![Uuid::new_v4().to_string(),new_event_id,actor_id,format!("Created from a copy of {title}"),now],
    );
    CommandResult::ok(EventRecord {
        id: new_event_id,
        owner_id,
        title: title.to_string(),
        description,
        category,
        venue,
        starts_at: new_start.to_rfc3339(),
        capacity,
        visibility,
        created_at: now,
    })
}

#[tauri::command]
pub fn delete_event(
    state: State<'_, DbState>,
    event_id: String,
    actor_id: String,
) -> CommandResult<bool> {
    let conn = match state.conn() {
        Ok(c) => c,
        Err(e) => return CommandResult::err(&format!("Database error: {e}")),
    };

    let stmt = conn
        .prepare("SELECT owner_id FROM events WHERE id = ?1")
        .ok();
    let owner = match stmt {
        Some(mut s) => s
            .query_row(params![event_id], |row| row.get::<_, String>(0))
            .ok(),
        None => None,
    };
    let owner_id = match owner {
        Some(o) => o,
        None => return CommandResult::err("Event not found."),
    };
    if owner_id != actor_id {
        return CommandResult::err("Only the event owner can delete the event.");
    }

    let deleted = conn.execute("DELETE FROM events WHERE id = ?1", params![event_id]);
    if !matches!(deleted, Ok(1..)) {
        return CommandResult::err("Event not found.");
    }

    // Hand the deletion to the website on the next sync cycle.
    enqueue_event_change(&conn, "delete", &serde_json::json!({ "id": event_id }));

    CommandResult::ok(true)
}

#[tauri::command]
pub fn get_event_activity(
    state: State<'_, DbState>,
    event_id: String,
    user_id: String,
) -> CommandResult<Vec<ActivityEntry>> {
    let conn = match state.conn() {
        Ok(c) => c,
        Err(e) => return CommandResult::err(&format!("Database error: {e}")),
    };

    let role = match event_role(&conn, &event_id, &user_id) {
        Ok(Some(role)) => Some(role),
        Ok(None) => match can_view_event(&conn, &event_id, &user_id) {
            Ok(true) => None,
            Ok(false) => return CommandResult::err("You do not have access to this event."),
            Err(error) => return CommandResult::err(&format!("Database error: {error}")),
        },
        Err(error) => return CommandResult::err(&format!("Database error: {error}")),
    };

    let mut stmt = match conn.prepare(
        "SELECT a.id, a.kind, a.summary, a.created_at, u.name, u.avatar_url
         FROM event_activity a
         LEFT JOIN users u ON u.id = a.actor_id
         WHERE a.event_id = ?1
         ORDER BY a.created_at DESC
         LIMIT 50",
    ) {
        Ok(s) => s,
        Err(e) => return CommandResult::err(&format!("Database error: {e}")),
    };

    let rows = stmt.query_map(params![event_id], |row| {
        Ok(ActivityEntry {
            id: row.get(0)?,
            kind: row.get(1)?,
            summary: row.get(2)?,
            created_at: row.get(3)?,
            actor_name: row.get(4)?,
            actor_avatar_url: row.get(5)?,
        })
    });

    let mut activities = Vec::new();
    match rows {
        Ok(rows) => {
            for row in rows {
                match row {
                    Ok(activity)
                        if role.is_some()
                            || activity.kind == "event"
                            || activity.kind == "agenda" =>
                    {
                        activities.push(activity)
                    }
                    Ok(_) => {}
                    Err(e) => return CommandResult::err(&format!("Database error: {e}")),
                }
            }
        }
        Err(e) => return CommandResult::err(&format!("Database error: {e}")),
    }

    CommandResult::ok(activities)
}

#[tauri::command]
pub fn log_event_activity(
    state: State<'_, DbState>,
    input: LogActivityInput,
) -> CommandResult<bool> {
    let conn = match state.conn() {
        Ok(c) => c,
        Err(e) => return CommandResult::err(&format!("Database error: {e}")),
    };

    match event_role(&conn, &input.event_id, &input.actor_id) {
        Ok(Some(role)) if role != "viewer" => {}
        Ok(Some(_)) => return CommandResult::err("Viewers cannot add event activity."),
        Ok(None) => return CommandResult::err("You do not have access to this event."),
        Err(error) => return CommandResult::err(&format!("Database error: {error}")),
    }

    let summary: String = input
        .summary
        .trim()
        .split_whitespace()
        .collect::<Vec<&str>>()
        .join(" ")
        .chars()
        .take(300)
        .collect();

    if summary.is_empty() {
        return CommandResult::ok(true);
    }

    conn.execute(
        "INSERT INTO event_activity (id, event_id, actor_id, kind, summary, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            Uuid::new_v4().to_string(),
            input.event_id,
            input.actor_id,
            input.kind,
            summary,
            Utc::now().to_rfc3339(),
        ],
    )
    .ok();

    CommandResult::ok(true)
}

#[tauri::command]
pub fn get_event(
    state: State<'_, DbState>,
    event_id: String,
    user_id: String,
) -> CommandResult<EventRecord> {
    let conn = match state.conn() {
        Ok(c) => c,
        Err(e) => return CommandResult::err(&format!("Database error: {e}")),
    };

    let row: Option<(
        String,
        String,
        String,
        String,
        String,
        String,
        String,
        Option<i32>,
        String,
        String,
    )> = {
        let mut stmt = match conn.prepare(
            "SELECT id, owner_id, title, description, category, venue, starts_at, capacity, visibility, created_at FROM events
             WHERE id = ?1 AND (owner_id = ?2 OR visibility = 'public'
               OR EXISTS (SELECT 1 FROM event_members WHERE event_id=?1 AND user_id=?2 AND status='accepted')
               OR EXISTS (SELECT 1 FROM synced_event_members WHERE event_id=?1 AND user_id=?2 AND status='accepted'))",
        ) {
            Ok(s) => s,
            Err(_) => return CommandResult::err("Event not found."),
        };
        let row = match stmt.query_row(params![event_id, user_id], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
                row.get(6)?,
                row.get(7)?,
                row.get(8)?,
                row.get(9)?,
            ))
        }) {
            Ok(r) => Some(r),
            Err(_) => None,
        };
        row
    };

    let Some((
        id,
        owner_id,
        title,
        description,
        category,
        venue,
        starts_at,
        capacity,
        visibility,
        created_at,
    )) = row
    else {
        return CommandResult::err("Event not found.");
    };

    CommandResult::ok(EventRecord {
        id,
        owner_id,
        title,
        description,
        category,
        venue,
        starts_at,
        capacity,
        visibility,
        created_at,
    })
}
