use crate::db::DbState;
use crate::types::CommandResult;
use base64::{Engine as _, engine::general_purpose::STANDARD};
use chrono::Utc;
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::{Value, json};
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

const MAX_FILE_BYTES: usize = 20 * 1024 * 1024;

fn log_work_activity(conn: &Connection, event_id: &str, actor_id: &str, kind: &str, summary: &str) {
    let clean = summary.split_whitespace().collect::<Vec<_>>().join(" ");
    let clean: String = clean.chars().take(300).collect();
    if clean.is_empty() {
        return;
    }
    let _ = conn.execute(
        "INSERT INTO event_activity (id,event_id,actor_id,kind,summary,created_at) VALUES (?1,?2,?3,?4,?5,?6)",
        params![Uuid::new_v4().to_string(), event_id, actor_id, kind, clean, Utc::now().to_rfc3339()],
    );
}

fn role_for(conn: &Connection, event_id: &str, user_id: &str) -> rusqlite::Result<Option<String>> {
    let owner: Option<String> = conn
        .query_row(
            "SELECT owner_id FROM events WHERE id = ?1",
            params![event_id],
            |row| row.get(0),
        )
        .optional()?;
    if owner.as_deref() == Some(user_id) {
        return Ok(Some("owner".into()));
    }
    let role: Option<String> = conn.query_row(
        "SELECT role FROM event_members WHERE event_id = ?1 AND user_id = ?2 AND status = 'accepted'
         UNION ALL SELECT role FROM synced_event_members WHERE event_id = ?1 AND user_id = ?2 AND status = 'accepted' LIMIT 1",
        params![event_id, user_id], |row| row.get(0),
    ).optional()?;
    Ok(role)
}

fn can_edit(role: &str) -> bool {
    role != "viewer"
}
fn can_manage(role: &str) -> bool {
    role == "owner" || role == "admin"
}
fn valid_task_assignee(conn: &Connection, event_id: &str, user_id: &str) -> rusqlite::Result<bool> {
    conn.query_row(
        "SELECT EXISTS(
            SELECT 1 FROM events WHERE id = ?1 AND owner_id = ?2
            UNION ALL
            SELECT 1 FROM event_members WHERE event_id = ?1 AND user_id = ?2 AND status = 'accepted'
            UNION ALL
            SELECT 1 FROM synced_event_members WHERE event_id = ?1 AND user_id = ?2 AND status = 'accepted'
        )",
        params![event_id, user_id],
        |row| row.get(0),
    )
}

fn ensure_task_assignee_user(
    conn: &Connection,
    event_id: &str,
    user_id: &str,
) -> rusqlite::Result<()> {
    let member: Option<String> = conn.query_row(
        "SELECT name FROM synced_event_members WHERE event_id=?1 AND user_id=?2 AND status='accepted'",
        params![event_id,user_id],
        |row| row.get(0),
    ).optional()?;
    let Some(name) = member else {
        return Ok(());
    };
    conn.execute(
        "INSERT OR IGNORE INTO users(id,name,email,provider,workspace_role,created_at) VALUES(?1,?2,?3,'sync-placeholder','member',?4)",
        params![user_id, if name.trim().is_empty() { "Event member" } else { &name }, format!("sync-{user_id}@placeholder.invalid"), Utc::now().to_rfc3339()],
    )?;
    Ok(())
}

fn access_error(conn: &Connection, event_id: &str, user_id: &str, manage: bool) -> Option<String> {
    match role_for(conn, event_id, user_id) {
        Ok(Some(role)) if !manage || can_manage(&role) => None,
        Ok(Some(_)) => Some("You do not have permission to change this event.".into()),
        Ok(None) => Some("You do not have access to this event.".into()),
        Err(error) => Some(format!("Database error: {error}")),
    }
}

fn queue_work_change(
    conn: &Connection,
    kind: &str,
    action: &str,
    event_id: &str,
    entity_id: &str,
    payload: &Value,
) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM work_sync_outbox WHERE kind=?1 AND event_id=?2 AND entity_id=?3",
        params![kind, event_id, entity_id],
    )?;
    conn.execute(
        "INSERT INTO work_sync_outbox (kind, action, event_id, entity_id, payload, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            kind,
            action,
            event_id,
            entity_id,
            payload.to_string(),
            Utc::now().to_rfc3339()
        ],
    )?;
    crate::sync::wake_sync();
    Ok(())
}

fn enqueue_current_work(
    conn: &Connection,
    kind: &str,
    action: &str,
    event_id: &str,
    entity_id: &str,
    upload_bytes: bool,
) -> rusqlite::Result<()> {
    let payload = match (kind, action) {
        (_, "delete") => json!({ "id": entity_id, "eventId": event_id, "updatedAt": Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true) }),
        ("task", _) => conn.query_row(
            "SELECT id,event_id,title,notes,status,assignee_id,due_at,created_at,updated_at FROM event_tasks WHERE id=?1 AND event_id=?2",
            params![entity_id,event_id],
            |r| Ok(json!({ "id":r.get::<_,String>(0)?,"eventId":r.get::<_,String>(1)?,"title":r.get::<_,String>(2)?,"notes":r.get::<_,String>(3)?,"status":r.get::<_,String>(4)?,"assigneeId":r.get::<_,Option<String>>(5)?,"dueAt":r.get::<_,Option<String>>(6)?,"createdAt":r.get::<_,String>(7)?,"updatedAt":r.get::<_,String>(8)? })),
        )?,
        ("agenda", _) => conn.query_row(
            "SELECT id,event_id,title,description,starts_at,duration_minutes,location,speaker_name,status,sort_order,created_at,updated_at FROM event_agenda_items WHERE id=?1 AND event_id=?2",
            params![entity_id,event_id],
            |r| Ok(json!({ "id":r.get::<_,String>(0)?,"eventId":r.get::<_,String>(1)?,"title":r.get::<_,String>(2)?,"description":r.get::<_,String>(3)?,"startsAt":r.get::<_,String>(4)?,"durationMinutes":r.get::<_,i32>(5)?,"location":r.get::<_,String>(6)?,"speakerName":r.get::<_,String>(7)?,"status":r.get::<_,String>(8)?,"sortOrder":r.get::<_,i32>(9)?,"createdAt":r.get::<_,String>(10)?,"updatedAt":r.get::<_,String>(11)? })),
        )?,
        ("file", _) => conn.query_row(
            "SELECT id,event_id,name,mime_type,size_bytes,storage_key,created_at,updated_at FROM event_files WHERE id=?1 AND event_id=?2",
            params![entity_id,event_id],
            |r| Ok(json!({ "id":r.get::<_,String>(0)?,"eventId":r.get::<_,String>(1)?,"name":r.get::<_,String>(2)?,"mimeType":r.get::<_,String>(3)?,"sizeBytes":r.get::<_,i64>(4)?,"storageKey":r.get::<_,String>(5)?,"createdAt":r.get::<_,String>(6)?,"updatedAt":r.get::<_,String>(7)?,"uploadBytes":upload_bytes })),
        )?,
        _ => return Err(rusqlite::Error::InvalidQuery),
    };
    queue_work_change(conn, kind, action, event_id, entity_id, &payload)
}

fn edit_error(conn: &Connection, event_id: &str, user_id: &str) -> Option<String> {
    match role_for(conn, event_id, user_id) {
        Ok(Some(role)) if can_edit(&role) => None,
        Ok(Some(_)) => Some("You do not have permission to change this event.".into()),
        Ok(None) => Some("You do not have access to this event.".into()),
        Err(error) => Some(format!("Database error: {error}")),
    }
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventTask {
    pub id: String,
    pub event_id: String,
    pub title: String,
    pub notes: String,
    pub status: String,
    pub assignee_id: Option<String>,
    pub assignee_name: Option<String>,
    pub due_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgendaItem {
    pub id: String,
    pub event_id: String,
    pub title: String,
    pub description: String,
    pub starts_at: String,
    pub duration_minutes: i32,
    pub location: String,
    pub speaker_name: String,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventFileRecord {
    pub id: String,
    pub event_id: String,
    pub name: String,
    pub mime_type: String,
    pub size_bytes: i64,
    pub uploader_name: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub detail: String,
    pub event_id: String,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskAssignee {
    pub id: String,
    pub name: String,
    pub email: String,
}

#[tauri::command]
pub fn list_event_task_assignees(
    state: State<'_, DbState>,
    event_id: String,
    user_id: String,
) -> CommandResult<Vec<TaskAssignee>> {
    let conn = match state.conn() {
        Ok(conn) => conn,
        Err(error) => return CommandResult::err(&format!("Database error: {error}")),
    };
    if let Some(error) = access_error(&conn, &event_id, &user_id, false) {
        return CommandResult::err(&error);
    }
    let mut statement = match conn.prepare(
        "SELECT id, name, email FROM users
         WHERE id = (SELECT owner_id FROM events WHERE id = ?1)
            OR id IN (SELECT user_id FROM event_members WHERE event_id = ?1 AND status = 'accepted')
         UNION
         SELECT user_id, name, email FROM synced_event_members
         WHERE event_id = ?1 AND status = 'accepted'
         ORDER BY name COLLATE NOCASE",
    ) {
        Ok(statement) => statement,
        Err(error) => return CommandResult::err(&format!("Database error: {error}")),
    };
    let rows = match statement.query_map(params![event_id], |row| {
        Ok(TaskAssignee {
            id: row.get(0)?,
            name: row.get(1)?,
            email: row.get(2)?,
        })
    }) {
        Ok(rows) => rows,
        Err(error) => return CommandResult::err(&format!("Database error: {error}")),
    };
    match rows.collect::<Result<Vec<_>, _>>() {
        Ok(assignees) => CommandResult::ok(assignees),
        Err(error) => CommandResult::err(&format!("Database error: {error}")),
    }
}

#[tauri::command]
pub fn list_event_tasks(
    state: State<'_, DbState>,
    event_id: String,
    user_id: String,
) -> CommandResult<Vec<EventTask>> {
    let conn = match state.conn() {
        Ok(c) => c,
        Err(e) => return CommandResult::err(&format!("Database error: {e}")),
    };
    if let Some(error) = access_error(&conn, &event_id, &user_id, false) {
        return CommandResult::err(&error);
    }
    let mut stmt = match conn.prepare("SELECT t.id,t.event_id,t.title,t.notes,t.status,t.assignee_id,COALESCE(u.name,sem.name),t.due_at,t.created_at,t.updated_at FROM event_tasks t LEFT JOIN users u ON u.id=t.assignee_id LEFT JOIN synced_event_members sem ON sem.user_id=t.assignee_id AND sem.event_id=t.event_id WHERE t.event_id=?1 ORDER BY CASE WHEN t.status='done' THEN 1 ELSE 0 END,t.created_at") { Ok(s)=>s, Err(e)=>return CommandResult::err(&format!("Database error: {e}")) };
    let rows = match stmt.query_map(params![event_id], |r| {
        Ok(EventTask {
            id: r.get(0)?,
            event_id: r.get(1)?,
            title: r.get(2)?,
            notes: r.get(3)?,
            status: r.get(4)?,
            assignee_id: r.get(5)?,
            assignee_name: r.get(6)?,
            due_at: r.get(7)?,
            created_at: r.get(8)?,
            updated_at: r.get(9)?,
        })
    }) {
        Ok(r) => r,
        Err(e) => return CommandResult::err(&format!("Database error: {e}")),
    };
    match rows.collect::<Result<Vec<_>, _>>() {
        Ok(v) => CommandResult::ok(v),
        Err(e) => CommandResult::err(&format!("Database error: {e}")),
    }
}

#[tauri::command]
pub fn create_event_task(
    state: State<'_, DbState>,
    event_id: String,
    actor_id: String,
    title: String,
    notes: String,
    assignee_id: Option<String>,
    due_at: Option<String>,
) -> CommandResult<EventTask> {
    let conn = match state.conn() {
        Ok(c) => c,
        Err(e) => return CommandResult::err(&format!("Database error: {e}")),
    };
    if let Some(error) = edit_error(&conn, &event_id, &actor_id) {
        return CommandResult::err(&error);
    }
    let title = title.trim().to_string();
    if title.is_empty() || title.len() > 140 {
        return CommandResult::err("Task title must be between 1 and 140 characters.");
    }
    if let Some(assignee) = assignee_id.as_deref() {
        match valid_task_assignee(&conn, &event_id, assignee) {
            Ok(true) => {}
            Ok(false) => {
                return CommandResult::err("Choose a person who has access to this event.");
            }
            Err(error) => return CommandResult::err(&format!("Database error: {error}")),
        }
        if let Err(error) = ensure_task_assignee_user(&conn, &event_id, assignee) {
            return CommandResult::err(&format!("Database error: {error}"));
        }
    }
    let assignee_name = assignee_id.as_deref().and_then(|id| {
        conn.query_row(
            "SELECT name FROM users WHERE id=?1 UNION ALL SELECT name FROM synced_event_members WHERE user_id=?1 AND event_id=?2 LIMIT 1",
            params![id, event_id],
            |row| row.get::<_, String>(0),
        ).ok()
    });
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    if let Err(e)=conn.execute("INSERT INTO event_tasks (id,event_id,title,notes,status,assignee_id,due_at,created_by,created_at,updated_at) VALUES (?1,?2,?3,?4,'open',?5,?6,?7,?8,?8)",params![id,event_id,title,notes.trim(),assignee_id,due_at,actor_id,now]) { return CommandResult::err(&format!("Could not create task: {e}")); }
    if let Err(e) = enqueue_current_work(&conn, "task", "upsert", &event_id, &id, false) {
        return CommandResult::err(&format!("Could not queue task sync: {e}"));
    }
    log_work_activity(
        &conn,
        &event_id,
        &actor_id,
        "task",
        &format!("created task {title}"),
    );
    CommandResult::ok(EventTask {
        id,
        event_id,
        title,
        notes: notes.trim().into(),
        status: "open".into(),
        assignee_id,
        assignee_name,
        due_at,
        created_at: now.clone(),
        updated_at: now,
    })
}

#[tauri::command]
pub fn update_event_task(
    state: State<'_, DbState>,
    event_id: String,
    task_id: String,
    actor_id: String,
    title: String,
    notes: String,
    assignee_id: Option<String>,
    due_at: Option<String>,
) -> CommandResult<bool> {
    let conn = match state.conn() {
        Ok(c) => c,
        Err(e) => return CommandResult::err(&format!("Database error: {e}")),
    };
    if let Some(error) = edit_error(&conn, &event_id, &actor_id) {
        return CommandResult::err(&error);
    }
    let title = title.trim();
    if title.is_empty() || title.len() > 140 {
        return CommandResult::err("Task title must be between 1 and 140 characters.");
    }
    if let Some(assignee) = assignee_id.as_deref() {
        match valid_task_assignee(&conn, &event_id, assignee) {
            Ok(true) => {}
            Ok(false) => {
                return CommandResult::err("Choose a person who has access to this event.");
            }
            Err(error) => return CommandResult::err(&format!("Database error: {error}")),
        }
        if let Err(error) = ensure_task_assignee_user(&conn, &event_id, assignee) {
            return CommandResult::err(&format!("Database error: {error}"));
        }
    }
    match conn.execute(
        "UPDATE event_tasks SET title=?1,notes=?2,assignee_id=?3,due_at=?4,updated_at=?5 WHERE id=?6 AND event_id=?7",
        params![title, notes.trim(), assignee_id, due_at, Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true), task_id, event_id],
    ) {
        Ok(n) if n > 0 => match enqueue_current_work(&conn, "task", "upsert", &event_id, &task_id, false) { Ok(()) => { log_work_activity(&conn, &event_id, &actor_id, "task", &format!("updated task {title}")); CommandResult::ok(true) }, Err(e) => CommandResult::err(&format!("Could not queue task sync: {e}")) },
        Ok(_) => CommandResult::err("Task not found."),
        Err(e) => CommandResult::err(&format!("Could not update task: {e}")),
    }
}

#[tauri::command]
pub fn set_event_task_status(
    state: State<'_, DbState>,
    event_id: String,
    task_id: String,
    actor_id: String,
    status: String,
) -> CommandResult<bool> {
    let conn = match state.conn() {
        Ok(c) => c,
        Err(e) => return CommandResult::err(&format!("Database error: {e}")),
    };
    if let Some(error) = edit_error(&conn, &event_id, &actor_id) {
        return CommandResult::err(&error);
    }
    let status = if status == "done" { "done" } else { "open" };
    let title = conn
        .query_row(
            "SELECT title FROM event_tasks WHERE id=?1 AND event_id=?2",
            params![task_id, event_id],
            |row| row.get::<_, String>(0),
        )
        .ok();
    match conn.execute(
        "UPDATE event_tasks SET status=?1,updated_at=?2 WHERE id=?3 AND event_id=?4",
        params![
            status,
            Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            task_id,
            event_id
        ],
    ) {
        Ok(n) if n > 0 => {
            match enqueue_current_work(&conn, "task", "upsert", &event_id, &task_id, false) {
                Ok(()) => {
                    if let Some(title) = title {
                        log_work_activity(
                            &conn,
                            &event_id,
                            &actor_id,
                            "task",
                            &format!("{title} marked {status}"),
                        );
                    }
                    CommandResult::ok(true)
                }
                Err(e) => CommandResult::err(&format!("Could not queue task sync: {e}")),
            }
        }
        Ok(_) => CommandResult::err("Task not found."),
        Err(e) => CommandResult::err(&format!("Could not update task: {e}")),
    }
}

#[tauri::command]
pub fn delete_event_task(
    state: State<'_, DbState>,
    event_id: String,
    task_id: String,
    actor_id: String,
) -> CommandResult<bool> {
    let conn = match state.conn() {
        Ok(c) => c,
        Err(e) => return CommandResult::err(&format!("Database error: {e}")),
    };
    if let Some(error) = access_error(&conn, &event_id, &actor_id, true) {
        return CommandResult::err(&error);
    }
    let title = conn
        .query_row(
            "SELECT title FROM event_tasks WHERE id=?1 AND event_id=?2",
            params![task_id, event_id],
            |row| row.get::<_, String>(0),
        )
        .ok();
    match conn.execute(
        "DELETE FROM event_tasks WHERE id=?1 AND event_id=?2",
        params![task_id, event_id],
    ) {
        Ok(n) if n > 0 => {
            match enqueue_current_work(&conn, "task", "delete", &event_id, &task_id, false) {
                Ok(()) => {
                    if let Some(title) = title {
                        log_work_activity(
                            &conn,
                            &event_id,
                            &actor_id,
                            "task",
                            &format!("deleted task {title}"),
                        );
                    }
                    CommandResult::ok(true)
                }
                Err(e) => CommandResult::err(&format!("Could not queue task deletion: {e}")),
            }
        }
        Ok(_) => CommandResult::err("Task not found."),
        Err(e) => CommandResult::err(&format!("Could not delete task: {e}")),
    }
}

#[tauri::command]
pub fn list_agenda_items(
    state: State<'_, DbState>,
    event_id: String,
    user_id: String,
) -> CommandResult<Vec<AgendaItem>> {
    let conn = match state.conn() {
        Ok(c) => c,
        Err(e) => return CommandResult::err(&format!("Database error: {e}")),
    };
    if let Some(error) = access_error(&conn, &event_id, &user_id, false) {
        return CommandResult::err(&error);
    }
    let mut stmt=match conn.prepare("SELECT id,event_id,title,description,starts_at,duration_minutes,location,speaker_name,status,created_at,updated_at FROM event_agenda_items WHERE event_id=?1 ORDER BY starts_at,sort_order,created_at"){Ok(s)=>s,Err(e)=>return CommandResult::err(&format!("Database error: {e}"))};
    let rows = match stmt.query_map(params![event_id], |r| {
        Ok(AgendaItem {
            id: r.get(0)?,
            event_id: r.get(1)?,
            title: r.get(2)?,
            description: r.get(3)?,
            starts_at: r.get(4)?,
            duration_minutes: r.get(5)?,
            location: r.get(6)?,
            speaker_name: r.get(7)?,
            status: r.get(8)?,
            created_at: r.get(9)?,
            updated_at: r.get(10)?,
        })
    }) {
        Ok(r) => r,
        Err(e) => return CommandResult::err(&format!("Database error: {e}")),
    };
    match rows.collect::<Result<Vec<_>, _>>() {
        Ok(v) => CommandResult::ok(v),
        Err(e) => CommandResult::err(&format!("Database error: {e}")),
    }
}

#[tauri::command]
pub fn save_agenda_item(
    state: State<'_, DbState>,
    event_id: String,
    actor_id: String,
    item_id: Option<String>,
    title: String,
    description: String,
    starts_at: String,
    duration_minutes: i32,
    location: String,
    speaker_name: String,
    status: String,
) -> CommandResult<AgendaItem> {
    let conn = match state.conn() {
        Ok(c) => c,
        Err(e) => return CommandResult::err(&format!("Database error: {e}")),
    };
    if let Some(error) = edit_error(&conn, &event_id, &actor_id) {
        return CommandResult::err(&error);
    }
    let title = title.trim().to_string();
    if title.is_empty() {
        return CommandResult::err("Session title cannot be empty.");
    }
    if chrono::DateTime::parse_from_rfc3339(&starts_at).is_err() {
        return CommandResult::err("Enter a valid session date and time.");
    }
    let duration = duration_minutes.clamp(5, 1440);
    let status = match status.as_str() {
        "live" => "live",
        "completed" => "completed",
        "cancelled" => "cancelled",
        _ => "scheduled",
    };
    let id = item_id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let now = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let existing_created_at: Option<String> = conn
        .query_row(
            "SELECT created_at FROM event_agenda_items WHERE id=?1 AND event_id=?2",
            params![id, event_id],
            |r| r.get(0),
        )
        .optional()
        .unwrap_or(None);
    let existing = existing_created_at.is_some();
    let result = if existing {
        conn.execute("UPDATE event_agenda_items SET title=?1,description=?2,starts_at=?3,duration_minutes=?4,location=?5,speaker_name=?6,status=?7,updated_at=?8 WHERE id=?9 AND event_id=?10",params![title,description.trim(),starts_at,duration,location.trim(),speaker_name.trim(),status,now,id,event_id])
    } else {
        conn.execute("INSERT INTO event_agenda_items (id,event_id,title,description,starts_at,duration_minutes,location,speaker_name,status,sort_order,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,0,?10,?10)",params![id,event_id,title,description.trim(),starts_at,duration,location.trim(),speaker_name.trim(),status,now])
    };
    if let Err(e) = result {
        return CommandResult::err(&format!("Could not save session: {e}"));
    }
    if let Err(e) = enqueue_current_work(&conn, "agenda", "upsert", &event_id, &id, false) {
        return CommandResult::err(&format!("Could not queue session sync: {e}"));
    }
    log_work_activity(
        &conn,
        &event_id,
        &actor_id,
        "agenda",
        &format!(
            "{} agenda session {title}",
            if existing { "updated" } else { "created" }
        ),
    );
    CommandResult::ok(AgendaItem {
        id,
        event_id,
        title,
        description: description.trim().into(),
        starts_at,
        duration_minutes: duration,
        location: location.trim().into(),
        speaker_name: speaker_name.trim().into(),
        status: status.into(),
        created_at: existing_created_at.unwrap_or_else(|| now.clone()),
        updated_at: now,
    })
}

#[tauri::command]
pub fn delete_agenda_item(
    state: State<'_, DbState>,
    event_id: String,
    actor_id: String,
    item_id: String,
) -> CommandResult<bool> {
    let conn = match state.conn() {
        Ok(c) => c,
        Err(e) => return CommandResult::err(&format!("Database error: {e}")),
    };
    if let Some(error) = edit_error(&conn, &event_id, &actor_id) {
        return CommandResult::err(&error);
    }
    let title = conn
        .query_row(
            "SELECT title FROM event_agenda_items WHERE id=?1 AND event_id=?2",
            params![item_id, event_id],
            |row| row.get::<_, String>(0),
        )
        .ok();
    match conn.execute(
        "DELETE FROM event_agenda_items WHERE id=?1 AND event_id=?2",
        params![item_id, event_id],
    ) {
        Ok(n) if n > 0 => {
            match enqueue_current_work(&conn, "agenda", "delete", &event_id, &item_id, false) {
                Ok(()) => {
                    if let Some(title) = title {
                        log_work_activity(
                            &conn,
                            &event_id,
                            &actor_id,
                            "agenda",
                            &format!("deleted agenda session {title}"),
                        );
                    }
                    CommandResult::ok(true)
                }
                Err(e) => CommandResult::err(&format!("Could not queue session deletion: {e}")),
            }
        }
        Ok(_) => CommandResult::err("Session not found."),
        Err(e) => CommandResult::err(&format!("Could not delete session: {e}")),
    }
}

fn safe_file_name(name: &str) -> String {
    let name = name
        .replace(['\\', '/'], "_")
        .chars()
        .filter(|c| !c.is_control())
        .take(180)
        .collect::<String>();
    if name.trim().is_empty() {
        "untitled".into()
    } else {
        name
    }
}

#[tauri::command]
pub fn list_event_files(
    state: State<'_, DbState>,
    event_id: String,
    user_id: String,
) -> CommandResult<Vec<EventFileRecord>> {
    let conn = match state.conn() {
        Ok(c) => c,
        Err(e) => return CommandResult::err(&format!("Database error: {e}")),
    };
    if let Some(error) = access_error(&conn, &event_id, &user_id, false) {
        return CommandResult::err(&error);
    }
    let mut stmt=match conn.prepare("SELECT f.id,f.event_id,f.name,f.mime_type,f.size_bytes,COALESCE(u.name,'Unknown'),f.created_at,f.updated_at FROM event_files f LEFT JOIN users u ON u.id=f.uploaded_by WHERE f.event_id=?1 ORDER BY f.created_at DESC"){Ok(s)=>s,Err(e)=>return CommandResult::err(&format!("Database error: {e}"))};
    let rows = match stmt.query_map(params![event_id], |r| {
        Ok(EventFileRecord {
            id: r.get(0)?,
            event_id: r.get(1)?,
            name: r.get(2)?,
            mime_type: r.get(3)?,
            size_bytes: r.get(4)?,
            uploader_name: r.get(5)?,
            created_at: r.get(6)?,
            updated_at: r.get(7)?,
        })
    }) {
        Ok(r) => r,
        Err(e) => return CommandResult::err(&format!("Database error: {e}")),
    };
    match rows.collect::<Result<Vec<_>, _>>() {
        Ok(v) => CommandResult::ok(v),
        Err(e) => CommandResult::err(&format!("Database error: {e}")),
    }
}

#[tauri::command]
pub fn upload_event_file(
    app: AppHandle,
    state: State<'_, DbState>,
    event_id: String,
    actor_id: String,
    name: String,
    mime_type: String,
    data_base64: String,
) -> CommandResult<EventFileRecord> {
    let conn = match state.conn() {
        Ok(c) => c,
        Err(e) => return CommandResult::err(&format!("Database error: {e}")),
    };
    if let Some(error) = access_error(&conn, &event_id, &actor_id, true) {
        return CommandResult::err(&error);
    }
    let bytes = match STANDARD.decode(data_base64.as_bytes()) {
        Ok(b) => b,
        Err(_) => return CommandResult::err("The selected file could not be read."),
    };
    if bytes.is_empty() {
        return CommandResult::err("That file is empty.");
    }
    if bytes.len() > MAX_FILE_BYTES {
        return CommandResult::err("Files must be 20 MB or smaller.");
    }
    let name = safe_file_name(&name);
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let dir = match app.path().app_data_dir() {
        Ok(p) => p.join("uploads").join(&event_id),
        Err(e) => return CommandResult::err(&format!("Could not locate file storage: {e}")),
    };
    if let Err(e) = std::fs::create_dir_all(&dir) {
        return CommandResult::err(&format!("Could not create file storage: {e}"));
    }
    let path = dir.join(&id);
    if let Err(e) = std::fs::write(&path, &bytes) {
        return CommandResult::err(&format!("Could not store file: {e}"));
    }
    if let Err(e)=conn.execute("INSERT INTO event_files (id,event_id,name,mime_type,size_bytes,storage_key,uploaded_by,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?8)",params![id,event_id,name,mime_type,bytes.len() as i64,path.to_string_lossy(),actor_id,now]){let _=std::fs::remove_file(path);return CommandResult::err(&format!("Could not save file record: {e}"))}
    if let Err(e) = enqueue_current_work(&conn, "file", "upsert", &event_id, &id, true) {
        return CommandResult::err(&format!("Could not queue file sync: {e}"));
    }
    log_work_activity(
        &conn,
        &event_id,
        &actor_id,
        "file",
        &format!("uploaded {name}"),
    );
    let uploader = conn
        .query_row(
            "SELECT name FROM users WHERE id=?1",
            params![actor_id],
            |r| r.get(0),
        )
        .unwrap_or_else(|_| "You".into());
    CommandResult::ok(EventFileRecord {
        id,
        event_id,
        name,
        mime_type,
        size_bytes: bytes.len() as i64,
        uploader_name: uploader,
        created_at: now.clone(),
        updated_at: now,
    })
}

#[tauri::command]
pub fn download_event_file(
    app: AppHandle,
    state: State<'_, DbState>,
    event_id: String,
    user_id: String,
    file_id: String,
) -> CommandResult<String> {
    let conn = match state.conn() {
        Ok(c) => c,
        Err(e) => return CommandResult::err(&format!("Database error: {e}")),
    };
    if let Some(error) = access_error(&conn, &event_id, &user_id, false) {
        return CommandResult::err(&error);
    }
    let path: Option<String> = conn
        .query_row(
            "SELECT storage_key FROM event_files WHERE id=?1 AND event_id=?2",
            params![file_id, event_id],
            |r| r.get(0),
        )
        .optional()
        .unwrap_or(None);
    let Some(path) = path else {
        return CommandResult::err("File not found.");
    };
    let root = match app.path().app_data_dir() {
        Ok(p) => p.join("uploads"),
        Err(e) => return CommandResult::err(&format!("Could not locate file storage: {e}")),
    };
    let path = PathBuf::from(path);
    if !path.starts_with(&root) {
        return CommandResult::err("Invalid file location.");
    }
    match std::fs::read(path) {
        Ok(bytes) => CommandResult::ok(STANDARD.encode(bytes)),
        Err(e) => CommandResult::err(&format!("Could not read file: {e}")),
    }
}

#[tauri::command]
pub fn rename_event_file(
    state: State<'_, DbState>,
    event_id: String,
    actor_id: String,
    file_id: String,
    new_name: String,
) -> CommandResult<bool> {
    let conn = match state.conn() {
        Ok(c) => c,
        Err(e) => return CommandResult::err(&format!("Database error: {e}")),
    };
    if let Some(error) = access_error(&conn, &event_id, &actor_id, true) {
        return CommandResult::err(&error);
    }
    let name = safe_file_name(&new_name);
    if name == "untitled" && new_name.trim().is_empty() {
        return CommandResult::err("Enter a file name.");
    }
    match conn.execute(
        "UPDATE event_files SET name=?1,updated_at=?2 WHERE id=?3 AND event_id=?4",
        params![
            name,
            Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            file_id,
            event_id
        ],
    ) {
        Ok(1) => match enqueue_current_work(&conn, "file", "upsert", &event_id, &file_id, false) {
            Ok(()) => {
                log_work_activity(
                    &conn,
                    &event_id,
                    &actor_id,
                    "file",
                    &format!("renamed file to {name}"),
                );
                CommandResult::ok(true)
            }
            Err(e) => CommandResult::err(&format!("Could not queue file sync: {e}")),
        },
        Ok(_) => CommandResult::err("File not found."),
        Err(error) => CommandResult::err(&format!("Could not rename file: {error}")),
    }
}

#[tauri::command]
pub fn delete_event_file(
    app: AppHandle,
    state: State<'_, DbState>,
    event_id: String,
    actor_id: String,
    file_id: String,
) -> CommandResult<bool> {
    let conn = match state.conn() {
        Ok(c) => c,
        Err(e) => return CommandResult::err(&format!("Database error: {e}")),
    };
    if let Some(error) = access_error(&conn, &event_id, &actor_id, true) {
        return CommandResult::err(&error);
    }
    let file: Option<(String, String)> = conn
        .query_row(
            "SELECT storage_key,name FROM event_files WHERE id=?1 AND event_id=?2",
            params![file_id, event_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .unwrap_or(None);
    let Some((path, name)) = file else {
        return CommandResult::err("File not found.");
    };
    if let Err(e) = conn.execute(
        "DELETE FROM event_files WHERE id=?1 AND event_id=?2",
        params![file_id, event_id],
    ) {
        return CommandResult::err(&format!("Could not delete file record: {e}"));
    }
    if let Err(e) = queue_work_change(
        &conn,
        "file",
        "delete",
        &event_id,
        &file_id,
        &json!({ "id":file_id,"eventId":event_id,"name":name,"updatedAt":Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true) }),
    ) {
        return CommandResult::err(&format!("Could not queue file deletion: {e}"));
    }
    log_work_activity(
        &conn,
        &event_id,
        &actor_id,
        "file",
        &format!("deleted {name}"),
    );
    if let Ok(root) = app.path().app_data_dir() {
        let path = PathBuf::from(path);
        if path.starts_with(root.join("uploads")) {
            let _ = std::fs::remove_file(path);
        }
    }
    CommandResult::ok(true)
}

#[tauri::command]
pub fn search_workspace(
    state: State<'_, DbState>,
    user_id: String,
    query: String,
) -> CommandResult<Vec<SearchResult>> {
    let conn = match state.conn() {
        Ok(c) => c,
        Err(e) => return CommandResult::err(&format!("Database error: {e}")),
    };
    let query = query.trim();
    if query.is_empty() {
        return CommandResult::ok(vec![]);
    }
    let pattern = format!("%{}%", query.replace('%', "\\%").replace('_', "\\_"));
    let mut out = Vec::new();
    let mut add_query = |sql: &str, kind: &str| -> Result<(), String> {
        let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![user_id, pattern], |r| {
                Ok(SearchResult {
                    id: r.get(0)?,
                    kind: kind.into(),
                    title: r.get(1)?,
                    detail: r.get(2)?,
                    event_id: r.get(3)?,
                })
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            out.push(row.map_err(|e| e.to_string())?)
        }
        Ok(())
    };
    let event_access = "(e.owner_id=?1 OR EXISTS(SELECT 1 FROM event_members em WHERE em.event_id=e.id AND em.user_id=?1 AND em.status='accepted') OR EXISTS(SELECT 1 FROM synced_event_members sm WHERE sm.event_id=e.id AND sm.user_id=?1 AND sm.status='accepted'))";
    let event_sql = format!(
        "SELECT e.id,e.title,e.category || ' · ' || e.venue,e.id FROM events e WHERE {event_access} AND (e.title LIKE ?2 OR e.description LIKE ?2 OR e.venue LIKE ?2) ORDER BY e.starts_at LIMIT 30"
    );
    if let Err(e) = add_query(&event_sql, "Event") {
        return CommandResult::err(&format!("Search failed: {e}"));
    }
    let task_sql = format!(
        "SELECT t.id,t.title,'Task · ' || e.title,t.event_id FROM event_tasks t JOIN events e ON e.id=t.event_id WHERE {event_access} AND (t.title LIKE ?2 OR t.notes LIKE ?2) ORDER BY t.created_at DESC LIMIT 30"
    );
    if let Err(e) = add_query(&task_sql, "Task") {
        return CommandResult::err(&format!("Search failed: {e}"));
    }
    let file_sql = format!(
        "SELECT f.id,f.name,'File · ' || e.title,f.event_id FROM event_files f JOIN events e ON e.id=f.event_id WHERE {event_access} AND f.name LIKE ?2 ORDER BY f.created_at DESC LIMIT 30"
    );
    if let Err(e) = add_query(&file_sql, "File") {
        return CommandResult::err(&format!("Search failed: {e}"));
    }
    let agenda_sql = format!(
        "SELECT a.id,a.title,'Schedule · ' || e.title,a.event_id FROM event_agenda_items a JOIN events e ON e.id=a.event_id WHERE {event_access} AND (a.title LIKE ?2 OR a.description LIKE ?2 OR a.speaker_name LIKE ?2) ORDER BY a.starts_at LIMIT 30"
    );
    if let Err(e) = add_query(&agenda_sql, "Schedule") {
        return CommandResult::err(&format!("Search failed: {e}"));
    }
    let people_sql = "SELECT * FROM (
        SELECT em.id,u.name,u.email,em.event_id FROM event_members em JOIN users u ON u.id=em.user_id JOIN events e ON e.id=em.event_id WHERE (e.owner_id=?1 OR EXISTS(SELECT 1 FROM event_members own WHERE own.event_id=e.id AND own.user_id=?1 AND own.status='accepted')) AND em.status='accepted' AND (u.name LIKE ?2 OR u.email LIKE ?2)
        UNION
        SELECT sm.id,sm.name,sm.email,sm.event_id FROM synced_event_members sm JOIN events e ON e.id=sm.event_id WHERE e.owner_id=?1 AND sm.status='accepted' AND (sm.name LIKE ?2 OR sm.email LIKE ?2)
    ) ORDER BY 2 LIMIT 30";
    if let Err(e) = add_query(people_sql, "Person") {
        return CommandResult::err(&format!("Search failed: {e}"));
    }
    CommandResult::ok(out)
}
