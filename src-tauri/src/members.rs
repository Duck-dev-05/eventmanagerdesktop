use crate::db::DbState;
use crate::types::{AddMemberInput, CommandResult, EventMember, SyncedEventMember};
use rusqlite::params;
use tauri::State;
use uuid::Uuid;

#[tauri::command]
pub fn list_event_members(
    state: State<'_, DbState>,
    event_id: String,
    user_id: String,
) -> CommandResult<Vec<EventMember>> {
    let conn = match state.conn() {
        Ok(c) => c,
        Err(e) => return CommandResult::err(&format!("Database error: {e}")),
    };

    match crate::events::event_role(&conn, &event_id, &user_id) {
        Ok(Some(_)) => {}
        Ok(None) => return CommandResult::err("You do not have access to this event's team."),
        Err(error) => return CommandResult::err(&format!("Database error: {error}")),
    }

    let mut stmt = match conn.prepare(
        "SELECT em.id, em.event_id, em.user_id, em.role, em.invited_by, em.invited_at, em.status
         FROM event_members em
         WHERE em.event_id = ?1 AND em.status = 'accepted'",
    ) {
        Ok(s) => s,
        Err(e) => return CommandResult::err(&format!("Database error: {e}")),
    };

    let rows = stmt.query_map(params![event_id], |row| {
        Ok(EventMember {
            id: row.get(0)?,
            event_id: row.get(1)?,
            user_id: row.get(2)?,
            role: row.get(3)?,
            invited_by: row.get(4)?,
            invited_at: row.get(5)?,
            status: row.get(6)?,
        })
    });

    let mut members = Vec::new();
    match rows {
        Ok(rows) => {
            for row in rows {
                match row {
                    Ok(member) => members.push(member),
                    Err(e) => return CommandResult::err(&format!("Database error: {e}")),
                }
            }
        }
        Err(e) => return CommandResult::err(&format!("Database error: {e}")),
    }

    CommandResult::ok(members)
}

#[tauri::command]
pub fn list_synced_event_members(
    state: State<'_, DbState>,
    event_id: String,
    user_id: String,
) -> CommandResult<Vec<SyncedEventMember>> {
    let conn = match state.conn() {
        Ok(conn) => conn,
        Err(error) => return CommandResult::err(&format!("Database error: {error}")),
    };
    let mut statement = match conn.prepare(
        "SELECT m.id, m.event_id, m.user_id, m.name, m.email, m.avatar_url, m.role, m.invited_at, m.status
         FROM synced_event_members m
         JOIN events e ON e.id = m.event_id
         WHERE m.event_id = ?1 AND e.owner_id = ?2
         ORDER BY m.invited_at, m.id",
    ) {
        Ok(statement) => statement,
        Err(error) => return CommandResult::err(&format!("Database error: {error}")),
    };
    let rows = match statement.query_map(params![event_id, user_id], |row| {
        Ok(SyncedEventMember {
            id: row.get(0)?,
            event_id: row.get(1)?,
            user_id: row.get(2)?,
            name: row.get(3)?,
            email: row.get(4)?,
            avatar_url: row.get(5)?,
            role: row.get(6)?,
            invited_at: row.get(7)?,
            status: row.get(8)?,
        })
    }) {
        Ok(rows) => rows,
        Err(error) => return CommandResult::err(&format!("Database error: {error}")),
    };
    let members = match rows.collect::<Result<Vec<_>, _>>() {
        Ok(members) => members,
        Err(error) => return CommandResult::err(&format!("Database error: {error}")),
    };
    CommandResult::ok(members)
}

#[tauri::command]
pub fn add_event_member(
    state: State<'_, DbState>,
    event_id: String,
    actor_id: String,
    input: AddMemberInput,
) -> CommandResult<EventMember> {
    let conn = match state.conn() {
        Ok(c) => c,
        Err(e) => return CommandResult::err(&format!("Database error: {e}")),
    };

    let role = match crate::events::event_role(&conn, &event_id, &actor_id) {
        Ok(Some(role)) => role,
        Ok(None) => return CommandResult::err("You do not have access to this event."),
        Err(error) => return CommandResult::err(&format!("Database error: {error}")),
    };
    if role != "owner" && role != "admin" {
        return CommandResult::err("Only event owners and admins can invite members.");
    }

    let stmt = conn.prepare("SELECT id FROM users WHERE email = ?1").ok();
    let user = match stmt {
        Some(mut s) => s
            .query_row(params![input.email], |row| row.get::<_, String>(0))
            .ok(),
        None => None,
    };
    let target_user_id = match user {
        Some(u) => u,
        None => return CommandResult::err("No user found with this email address."),
    };
    if target_user_id == actor_id {
        return CommandResult::err("You cannot invite yourself.");
    }

    let member_id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let stmt = conn
        .prepare("SELECT 1 FROM event_members WHERE event_id = ?1 AND user_id = ?2 LIMIT 1")
        .ok();
    let existing = match stmt {
        Some(mut s) => s
            .query_row(params![event_id, target_user_id], |_| Ok(true))
            .ok(),
        None => None,
    };
    let existing = match existing {
        Some(_) => true,
        None => false,
    };
    if existing {
        return CommandResult::err("This person is already a member of the event.");
    }

    conn.execute(
        "INSERT INTO event_members (id, event_id, user_id, role, invited_by, invited_at, status)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'accepted')",
        params![
            member_id,
            event_id,
            target_user_id,
            input.role,
            actor_id,
            now
        ],
    )
    .ok();

    CommandResult::ok(EventMember {
        id: member_id,
        event_id,
        user_id: target_user_id,
        role: input.role,
        invited_by: actor_id,
        invited_at: now,
        status: "accepted".to_string(),
    })
}

#[tauri::command]
pub fn remove_event_member(
    state: State<'_, DbState>,
    event_id: String,
    actor_id: String,
    user_id: String,
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

    let actor_role = crate::events::event_role(&conn, &event_id, &actor_id);
    let actor_role = match actor_role {
        Ok(Some(role)) => role,
        Ok(None) => return CommandResult::err("You do not have access to this event."),
        Err(error) => return CommandResult::err(&format!("Database error: {error}")),
    };
    if actor_id != user_id && actor_role != "owner" && actor_role != "admin" {
        return CommandResult::err("Only event owners and admins can remove members.");
    }

    if owner_id == user_id {
        return CommandResult::err("Owners cannot leave their own event.");
    }

    let deleted = conn.execute(
        "DELETE FROM event_members WHERE event_id = ?1 AND user_id = ?2",
        params![event_id, user_id],
    );
    let deleted = match deleted {
        Ok(d) => d,
        Err(_) => 0,
    };
    if deleted == 0 {
        return CommandResult::err("Member not found.");
    }

    CommandResult::ok(true)
}
