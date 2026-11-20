use chrono::Utc;
use reqwest::blocking::Client;
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::{Value, json};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

const CHUNK_BYTES: usize = 256 * 1024;

fn query_component(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

fn field<'a>(value: &'a Value, camel: &str, snake: &str) -> &'a Value {
    value
        .get(camel)
        .or_else(|| value.get(snake))
        .unwrap_or(&Value::Null)
}

fn string(value: &Value) -> &str {
    value.as_str().unwrap_or("")
}

fn timestamp_is_newer(left: &str, right: &str) -> bool {
    match (
        chrono::DateTime::parse_from_rfc3339(left),
        chrono::DateTime::parse_from_rfc3339(right),
    ) {
        (Ok(left), Ok(right)) => left > right,
        _ => left > right,
    }
}

fn timestamps_equal(left: &str, right: &str) -> bool {
    match (
        chrono::DateTime::parse_from_rfc3339(left),
        chrono::DateTime::parse_from_rfc3339(right),
    ) {
        (Ok(left), Ok(right)) => left == right,
        _ => left == right,
    }
}

fn remote_file_timestamp_wins(
    remote_updated_at: &str,
    local_updated_at: &str,
    storage_key: &str,
    upload_root: &std::path::Path,
) -> bool {
    timestamp_is_newer(remote_updated_at, local_updated_at)
        && PathBuf::from(storage_key).starts_with(upload_root)
}

fn ensure_shadow_user(conn: &Connection, id: &str, name: &str) -> rusqlite::Result<()> {
    if id.is_empty() {
        return Ok(());
    }
    conn.execute(
        "INSERT OR IGNORE INTO users (id,name,email,provider,workspace_role,created_at) VALUES (?1,?2,?3,'sync-placeholder','member',?4)",
        params![id, if name.is_empty() { "Event member" } else { name }, format!("sync-{id}@placeholder.invalid"), Utc::now().to_rfc3339()],
    )?;
    Ok(())
}

fn local_event_member_exists(conn: &Connection, event_id: &str, user_id: &str) -> bool {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM events e WHERE e.id=?1 AND e.owner_id=?2 UNION ALL SELECT 1 FROM event_members WHERE event_id=?1 AND user_id=?2 AND status='accepted' UNION ALL SELECT 1 FROM synced_event_members WHERE event_id=?1 AND user_id=?2 AND status='accepted')",
        params![event_id,user_id],
        |row| row.get(0),
    ).unwrap_or(false)
}

fn upload_pending_files(
    app: &AppHandle,
    client: &Client,
    base: &str,
    token: &str,
    device_id: &str,
    changes: &[(i64, String, String, String, Value)],
    pending_uploads: &[Value],
) -> Result<(), String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("uploads");
    for (_, kind, action, _, entity) in changes {
        if kind != "file"
            || action != "upsert"
            || !entity["uploadBytes"].as_bool().unwrap_or(false)
            || !pending_uploads
                .iter()
                .any(|pending| string(&pending["id"]) == string(&entity["id"]))
        {
            continue;
        }
        let file_id = string(&entity["id"]);
        let event_id = string(field(entity, "eventId", "event_id"));
        let local_path = PathBuf::from(string(field(entity, "storageKey", "storage_key")));
        if file_id.is_empty() || event_id.is_empty() || !local_path.starts_with(&root) {
            return Err(
                "Local upload path is invalid; the file was kept in the sync queue.".into(),
            );
        }
        let bytes = std::fs::read(&local_path)
            .map_err(|error| format!("Could not read local file for sync: {error}"))?;
        let size = bytes.len();
        let server_updated_at = pending_uploads
            .iter()
            .find(|pending| string(&pending["id"]) == file_id)
            .map(|pending| string(&pending["updatedAt"]))
            .unwrap_or("");
        let updated_at = query_component(server_updated_at);
        if updated_at.is_empty() {
            return Err("File update timestamp is missing; the file remains queued.".into());
        }
        if size == 0 || size > 20 * 1024 * 1024 {
            return Err("The local file is empty or exceeds the 20 MB sync limit.".into());
        }
        let expected_size = entity["sizeBytes"].as_u64();
        if expected_size.is_some_and(|expected| expected != size as u64) {
            return Err("The local file changed while it was queued for sync.".into());
        }
        let count = size.div_ceil(CHUNK_BYTES);
        for (index, chunk) in bytes.chunks(CHUNK_BYTES).enumerate() {
            let url = format!(
                "{base}/api/sync/work/files/{file_id}?eventId={event_id}&index={index}&count={count}&sizeBytes={size}&updatedAt={updated_at}"
            );
            let response = client
                .put(url)
                .header("Authorization", format!("Bearer {token}"))
                .header("X-Device-Id", device_id)
                .body(chunk.to_vec())
                .send()
                .map_err(|error| format!("File upload sync failed: {error}"))?;
            if response.status().as_u16() == 401 {
                return Err("Sync token was rejected. Re-pair on the website.".into());
            }
            if !response.status().is_success() {
                return Err(format!(
                    "File upload sync failed: HTTP {}",
                    response.status()
                ));
            }
        }
    }
    Ok(())
}

fn apply_tombstones(conn: &Connection, rows: &[Value], app: &AppHandle) -> Result<usize, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("uploads");
    let mut removed = 0;
    for row in rows {
        let kind = string(&row["kind"]);
        let id = string(field(row, "entityId", "entity_id"));
        let event_id = string(field(row, "eventId", "event_id"));
        let deleted_at = string(field(row, "deletedAt", "deleted_at"));
        if id.is_empty() || event_id.is_empty() {
            continue;
        }
        let (table, path_column) = match kind {
            "task" => ("event_tasks", None),
            "agenda" => ("event_agenda_items", None),
            "file" => ("event_files", Some("storage_key")),
            _ => continue,
        };
        if let Some(column) = path_column {
            let query = format!(
                "SELECT {column} FROM {table} WHERE id=?1 AND event_id=?2 AND updated_at<=?3"
            );
            let path: Option<String> = conn
                .query_row(&query, params![id, event_id, deleted_at], |r| r.get(0))
                .ok();
            if let Some(path) = path {
                let local = PathBuf::from(path);
                if local.starts_with(&root) {
                    let _ = std::fs::remove_file(local);
                }
            }
        }
        let query = format!("DELETE FROM {table} WHERE id=?1 AND event_id=?2 AND updated_at<=?3");
        removed += conn
            .execute(&query, params![id, event_id, deleted_at])
            .map_err(|e| e.to_string())?;
    }
    Ok(removed)
}

fn download_remote_files(
    app: &AppHandle,
    conn: &Connection,
    client: &Client,
    base: &str,
    token: &str,
    device_id: &str,
    files: &[Value],
) -> Result<usize, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("uploads");
    let mut downloaded = 0;
    for file in files {
        let id = string(&file["id"]);
        let event_id = string(field(file, "eventId", "event_id"));
        let size = field(file, "sizeBytes", "size_bytes").as_u64().unwrap_or(0) as usize;
        let remote_updated_at = string(field(file, "updatedAt", "updated_at"));
        if id.is_empty()
            || event_id.is_empty()
            || size == 0
            || size > 20 * 1024 * 1024
            || chrono::DateTime::parse_from_rfc3339(remote_updated_at).is_err()
        {
            continue;
        }
        let existing: Option<(String, String)> = conn
            .query_row(
                "SELECT storage_key,updated_at FROM event_files WHERE id=?1 AND event_id=?2",
                params![id, event_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .ok();
        let path = existing.as_ref().map(|row| row.0.as_str());
        if let Some(path) = path {
            if PathBuf::from(path).starts_with(&root) && std::path::Path::new(path).is_file() {
                continue;
            }
            if !path.starts_with("remote-pending:") {
                let remote_updated_at = string(field(file, "updatedAt", "updated_at"));
                let local_updated_at = existing
                    .as_ref()
                    .map(|row| row.1.as_str())
                    .unwrap_or_default();
                if !timestamps_equal(remote_updated_at, local_updated_at) {
                    continue;
                }
            }
        }
        let count = size.div_ceil(CHUNK_BYTES);
        let remote_updated_at = query_component(string(field(file, "updatedAt", "updated_at")));
        if remote_updated_at.is_empty() {
            continue;
        }
        let mut content = Vec::with_capacity(size);
        let mut complete = true;
        for index in 0..count {
            let url = format!(
                "{base}/api/sync/work/files/{id}?index={index}&updatedAt={remote_updated_at}"
            );
            let response = client
                .get(url)
                .header("Authorization", format!("Bearer {token}"))
                .header("X-Device-Id", device_id)
                .send()
                .map_err(|error| format!("File download sync failed: {error}"))?;
            if response.status().as_u16() == 401 {
                return Err("Sync token was rejected. Re-pair on the website.".into());
            }
            if !response.status().is_success() {
                complete = false;
                break;
            }
            content.extend_from_slice(&response.bytes().map_err(|error| error.to_string())?);
        }
        if !complete || content.len() != size {
            continue;
        }
        let folder = root.join(&event_id);
        std::fs::create_dir_all(&folder).map_err(|error| error.to_string())?;
        let local_path = folder.join(Uuid::new_v4().to_string());
        std::fs::write(&local_path, content).map_err(|error| error.to_string())?;
        let remote_updated_at = string(field(file, "updatedAt", "updated_at"));
        let changed = conn.execute(
            "UPDATE event_files SET storage_key=?1 WHERE id=?2 AND event_id=?3 AND updated_at=?4 AND storage_key=?5",
            params![local_path.to_string_lossy(), id, event_id, remote_updated_at, path],
        ).map_err(|error| error.to_string())?;
        if changed == 0 {
            let _ = std::fs::remove_file(local_path);
            continue;
        }
        downloaded += 1;
    }
    Ok(downloaded)
}

fn seed_legacy_work(conn: &Connection, app: &AppHandle) -> Result<(), String> {
    let seeded: bool = conn
        .query_row(
            "SELECT initial_seeded FROM work_sync_state WHERE id=1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .unwrap_or(false);
    if seeded {
        return Ok(());
    }
    let local_root = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("uploads");
    let now = Utc::now().to_rfc3339();
    let mut changes: Vec<(String, String, String, Value)> = Vec::new();
    {
        let mut stmt=conn.prepare("SELECT id,event_id,title,notes,status,assignee_id,due_at,created_at,updated_at FROM event_tasks").map_err(|e|e.to_string())?;
        let rows=stmt.query_map([],|r| Ok(json!({"id":r.get::<_,String>(0)?,"eventId":r.get::<_,String>(1)?,"title":r.get::<_,String>(2)?,"notes":r.get::<_,String>(3)?,"status":r.get::<_,String>(4)?,"assigneeId":r.get::<_,Option<String>>(5)?,"dueAt":r.get::<_,Option<String>>(6)?,"createdAt":r.get::<_,String>(7)?,"updatedAt":r.get::<_,String>(8)?}))).map_err(|e|e.to_string())?;
        for row in rows {
            let p = row.map_err(|e| e.to_string())?;
            changes.push((
                "task".into(),
                "upsert".into(),
                string(&p["eventId"]).into(),
                p,
            ));
        }
    }
    {
        let mut stmt=conn.prepare("SELECT id,event_id,title,description,starts_at,duration_minutes,location,speaker_name,status,sort_order,created_at,updated_at FROM event_agenda_items").map_err(|e|e.to_string())?;
        let rows=stmt.query_map([],|r| Ok(json!({"id":r.get::<_,String>(0)?,"eventId":r.get::<_,String>(1)?,"title":r.get::<_,String>(2)?,"description":r.get::<_,String>(3)?,"startsAt":r.get::<_,String>(4)?,"durationMinutes":r.get::<_,i32>(5)?,"location":r.get::<_,String>(6)?,"speakerName":r.get::<_,String>(7)?,"status":r.get::<_,String>(8)?,"sortOrder":r.get::<_,i32>(9)?,"createdAt":r.get::<_,String>(10)?,"updatedAt":r.get::<_,String>(11)?}))).map_err(|e|e.to_string())?;
        for row in rows {
            let p = row.map_err(|e| e.to_string())?;
            changes.push((
                "agenda".into(),
                "upsert".into(),
                string(&p["eventId"]).into(),
                p,
            ));
        }
    }
    {
        let mut stmt=conn.prepare("SELECT id,event_id,name,mime_type,size_bytes,storage_key,created_at,updated_at FROM event_files").map_err(|e|e.to_string())?;
        let rows=stmt.query_map([],|r| Ok(json!({"id":r.get::<_,String>(0)?,"eventId":r.get::<_,String>(1)?,"name":r.get::<_,String>(2)?,"mimeType":r.get::<_,String>(3)?,"sizeBytes":r.get::<_,i64>(4)?,"storageKey":r.get::<_,String>(5)?,"createdAt":r.get::<_,String>(6)?,"updatedAt":r.get::<_,String>(7)?}))).map_err(|e|e.to_string())?;
        for row in rows {
            let mut p = row.map_err(|e| e.to_string())?;
            let path = PathBuf::from(string(&p["storageKey"]));
            p["uploadBytes"] = json!(path.starts_with(&local_root));
            changes.push((
                "file".into(),
                "upsert".into(),
                string(&p["eventId"]).into(),
                p,
            ));
        }
    }
    for (kind, action, event_id, payload) in changes {
        conn.execute("INSERT INTO work_sync_outbox(kind,action,event_id,entity_id,payload,created_at) VALUES(?1,?2,?3,?4,?5,?6)",params![kind,action,event_id,string(&payload["id"]),payload.to_string(),now]).map_err(|e|e.to_string())?;
    }
    conn.execute("INSERT INTO work_sync_state(id,initial_seeded) VALUES(1,1) ON CONFLICT(id) DO UPDATE SET initial_seeded=1",[]).map_err(|e|e.to_string())?;
    Ok(())
}

pub fn sync_work(
    app: &AppHandle,
    conn: &Connection,
    client: &Client,
    base: &str,
    token: &str,
    device_id: &str,
    user_id: &str,
) -> Result<usize, String> {
    seed_legacy_work(conn, app)?;
    let pending: Vec<(i64, String, String, String, String)> = {
        let mut stmt = conn.prepare(
            "SELECT seq,kind,action,event_id,payload FROM work_sync_outbox ORDER BY seq LIMIT 50",
        ).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };
    if !pending.is_empty() {
        let changes: Vec<_> = pending
            .iter()
            .filter_map(|(seq, kind, action, _event_id, payload)| {
                serde_json::from_str::<Value>(payload)
                    .ok()
                    .map(|entity| (*seq, kind.clone(), action.clone(), payload.clone(), entity))
            })
            .collect();
        let body = json!({"action":"push","changes":changes.iter().map(|(_,kind,action,_,entity)| {
            let mut entity = entity.clone();
            if kind == "task" && field(&entity,"assigneeId","assignee_id").as_str() == Some(user_id) {
                entity["assigneeIsPairedUser"] = json!(true);
            }
            json!({"kind":kind,"action":action,"entity":entity})
        }).collect::<Vec<_>>()});
        let response = client
            .post(format!("{base}/api/sync/work"))
            .header("Authorization", format!("Bearer {token}"))
            .header("X-Device-Id", device_id)
            .json(&body)
            .send()
            .map_err(|error| format!("Work sync push failed: {error}"))?;
        if response.status().as_u16() == 401 {
            return Err("Sync token was rejected. Re-pair on the website.".into());
        }
        if !response.status().is_success() {
            return Err(format!("Work sync push failed: HTTP {}", response.status()));
        }
        let reply: Value = response
            .json()
            .map_err(|e| format!("Bad work sync push response: {e}"))?;
        if reply["accepted"].as_u64().unwrap_or(0) < changes.len() as u64 {
            return Err("Some work changes were rejected or their event is not synced yet; local changes remain queued.".into());
        }
        let pending_uploads = reply["pendingUploads"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        upload_pending_files(
            app,
            client,
            base,
            token,
            device_id,
            &changes,
            &pending_uploads,
        )?;
        for (seq, _, _, _, _) in &pending {
            conn.execute("DELETE FROM work_sync_outbox WHERE seq=?1", params![seq])
                .map_err(|e| e.to_string())?;
        }
    }

    let response = client
        .post(format!("{base}/api/sync/work"))
        .header("Authorization", format!("Bearer {token}"))
        .header("X-Device-Id", device_id)
        .json(&json!({"action":"pull"}))
        .send()
        .map_err(|error| format!("Work sync pull failed: {error}"))?;
    if response.status().as_u16() == 401 {
        return Err("Sync token was rejected. Re-pair on the website.".into());
    }
    if !response.status().is_success() {
        return Err(format!("Work sync pull failed: HTTP {}", response.status()));
    }
    let body: Value = response
        .json()
        .map_err(|e| format!("Bad work sync response: {e}"))?;
    let tasks = body["tasks"].as_array().cloned().unwrap_or_default();
    let agenda = body["agenda"].as_array().cloned().unwrap_or_default();
    let files = body["files"].as_array().cloned().unwrap_or_default();
    let tombstones = body["tombstones"].as_array().cloned().unwrap_or_default();
    let paired_user_id = string(&body["pairedUserId"]);
    let upload_root = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("uploads");
    let mut applied = 0;

    for task in &tasks {
        let id = string(&task["id"]);
        let event_id = string(field(task, "eventId", "event_id"));
        let remote_updated_at = string(field(task, "updatedAt", "updated_at"));
        if id.is_empty()
            || event_id.is_empty()
            || chrono::DateTime::parse_from_rfc3339(remote_updated_at).is_err()
        {
            continue;
        }
        let event_exists: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM events WHERE id=?1)",
                params![event_id],
                |r| r.get(0),
            )
            .unwrap_or(false);
        if !event_exists {
            continue;
        }
        let existing: Option<(String, String)> = conn
            .query_row(
                "SELECT event_id,updated_at FROM event_tasks WHERE id=?1",
                params![id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        if let Some((existing_event_id, local_updated_at)) = existing {
            if existing_event_id != event_id
                || timestamp_is_newer(&local_updated_at, remote_updated_at)
            {
                continue;
            }
        }
        let remote_assignee = field(task, "assigneeId", "assignee_id")
            .as_str()
            .filter(|s| !s.is_empty());
        let mapped_assignee =
            remote_assignee.map(|id| if id == paired_user_id { user_id } else { id });
        if let Some(assignee) = mapped_assignee.filter(|id| *id != user_id) {
            ensure_shadow_user(conn, assignee, string(&task["assigneeName"]))
                .map_err(|error| error.to_string())?;
        }
        let assignee_id =
            mapped_assignee.filter(|id| local_event_member_exists(conn, event_id, id));
        conn.execute(
            "INSERT INTO event_tasks(id,event_id,title,notes,status,assignee_id,due_at,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,notes=excluded.notes,status=excluded.status,assignee_id=excluded.assignee_id,due_at=excluded.due_at,updated_at=excluded.updated_at",
            params![id,event_id,string(&task["title"]),string(&task["notes"]),if string(&task["status"])=="done"{"done"}else{"open"},assignee_id,field(task,"dueAt","due_at").as_str(),user_id,string(field(task,"createdAt","created_at")),remote_updated_at],
        ).map_err(|e|format!("Could not apply synced task: {e}"))?;
        applied += 1;
    }

    for item in &agenda {
        let id = string(&item["id"]);
        let event_id = string(field(item, "eventId", "event_id"));
        let remote_updated_at = string(field(item, "updatedAt", "updated_at"));
        if id.is_empty()
            || event_id.is_empty()
            || chrono::DateTime::parse_from_rfc3339(remote_updated_at).is_err()
        {
            continue;
        }
        let event_exists: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM events WHERE id=?1)",
                params![event_id],
                |r| r.get(0),
            )
            .unwrap_or(false);
        if !event_exists {
            continue;
        }
        let existing: Option<(String, String)> = conn
            .query_row(
                "SELECT event_id,updated_at FROM event_agenda_items WHERE id=?1",
                params![id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        if let Some((existing_event_id, local_updated_at)) = existing {
            if existing_event_id != event_id
                || timestamp_is_newer(&local_updated_at, remote_updated_at)
            {
                continue;
            }
        }
        conn.execute(
            "INSERT INTO event_agenda_items(id,event_id,title,description,starts_at,duration_minutes,location,speaker_name,status,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,starts_at=excluded.starts_at,duration_minutes=excluded.duration_minutes,location=excluded.location,speaker_name=excluded.speaker_name,status=excluded.status,sort_order=excluded.sort_order,updated_at=excluded.updated_at",
            params![id,event_id,string(&item["title"]),string(&item["description"]),string(field(item,"startsAt","starts_at")),field(item,"durationMinutes","duration_minutes").as_i64().unwrap_or(30),string(&item["location"]),string(field(item,"speakerName","speaker_name")),string(&item["status"]),field(item,"sortOrder","sort_order").as_i64().unwrap_or(0),string(field(item,"createdAt","created_at")),remote_updated_at],
        ).map_err(|e|format!("Could not apply synced agenda session: {e}"))?;
        applied += 1;
    }

    for file in &files {
        let id = string(&file["id"]);
        let event_id = string(field(file, "eventId", "event_id"));
        if id.is_empty() || event_id.is_empty() {
            continue;
        }
        let event_exists: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM events WHERE id=?1)",
                params![event_id],
                |r| r.get(0),
            )
            .unwrap_or(false);
        if !event_exists {
            continue;
        }
        let existing: Option<(String, String)> = conn
            .query_row(
                "SELECT storage_key,updated_at FROM event_files WHERE id=?1 AND event_id=?2",
                params![id, event_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        let remote_updated_at = string(field(file, "updatedAt", "updated_at"));
        if chrono::DateTime::parse_from_rfc3339(remote_updated_at).is_err() {
            continue;
        }
        if let Some((storage_key, local_updated_at)) = existing {
            if remote_file_timestamp_wins(
                remote_updated_at,
                &local_updated_at,
                &storage_key,
                &upload_root,
            ) {
                conn.execute("UPDATE event_files SET name=?1,mime_type=?2,size_bytes=?3,storage_key=?4,updated_at=?5 WHERE id=?6 AND event_id=?7",params![string(&file["name"]),string(field(file,"mimeType","mime_type")),field(file,"sizeBytes","size_bytes").as_i64().unwrap_or(0),format!("remote-pending:{id}"),remote_updated_at,id,event_id]).map_err(|error|error.to_string())?;
            } else if storage_key.starts_with("remote-pending:")
                || timestamp_is_newer(remote_updated_at, &local_updated_at)
            {
                conn.execute("UPDATE event_files SET name=?1,mime_type=?2,size_bytes=?3,storage_key=CASE WHEN ?4 THEN storage_key ELSE ?5 END,updated_at=?6 WHERE id=?7 AND event_id=?8",params![string(&file["name"]),string(field(file,"mimeType","mime_type")),field(file,"sizeBytes","size_bytes").as_i64().unwrap_or(0),storage_key.starts_with("remote-pending:"),if storage_key.starts_with("remote-pending:"){storage_key.clone()}else{format!("remote-pending:{id}")},remote_updated_at,id,event_id]).map_err(|e|e.to_string())?;
            }
        } else {
            conn.execute("INSERT INTO event_files(id,event_id,name,mime_type,size_bytes,storage_key,uploaded_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",params![id,event_id,string(&file["name"]),string(field(file,"mimeType","mime_type")),field(file,"sizeBytes","size_bytes").as_i64().unwrap_or(0),format!("remote-pending:{id}"),user_id,string(field(file,"createdAt","created_at")),remote_updated_at]).map_err(|e|format!("Could not apply synced file: {e}"))?;
            applied += 1;
        }
    }

    applied += apply_tombstones(conn, &tombstones, app)?;
    applied += download_remote_files(app, conn, client, base, token, device_id, &files)?;
    Ok(applied)
}

#[cfg(test)]
mod tests {
    use super::{remote_file_timestamp_wins, timestamp_is_newer};

    #[test]
    fn work_sync_helpers_validate_members_and_timestamps() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE events(id TEXT,owner_id TEXT); CREATE TABLE event_members(event_id TEXT,user_id TEXT,status TEXT); CREATE TABLE synced_event_members(event_id TEXT,user_id TEXT,status TEXT);
            INSERT INTO events VALUES('event','owner');
            INSERT INTO event_members VALUES('event','member','accepted');
            INSERT INTO synced_event_members VALUES('event','synced-member','accepted');
            INSERT INTO event_members VALUES('event','pending','pending');").unwrap();
        assert!(super::local_event_member_exists(&conn, "event", "owner"));
        assert!(super::local_event_member_exists(&conn, "event", "member"));
        assert!(super::local_event_member_exists(
            &conn,
            "event",
            "synced-member"
        ));
        assert!(!super::local_event_member_exists(&conn, "event", "pending"));
        assert!(!super::local_event_member_exists(&conn, "event", "absent"));
        assert!(!timestamp_is_newer(
            "2025-01-01T12:00:00.123Z",
            "2025-01-01T12:00:00.123456789Z"
        ));
        assert!(timestamp_is_newer(
            "2025-01-01T12:00:00.124Z",
            "2025-01-01T12:00:00.123456789Z"
        ));
        assert!(remote_file_timestamp_wins(
            "2025-01-01T12:00:00.124Z",
            "2025-01-01T12:00:00.123456789Z",
            "C:/profile/uploads/event/file",
            std::path::Path::new("C:/profile/uploads"),
        ));
        assert!(!remote_file_timestamp_wins(
            "2025-01-01T12:00:00.124Z",
            "2025-01-01T12:00:00.123456789Z",
            "remote-pending:file",
            std::path::Path::new("C:/profile/uploads"),
        ));
    }
}
