use crate::db::DbState;
use crate::types::CommandResult;
use base64::{Engine as _, engine::general_purpose::STANDARD};
use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{Connection, params_from_iter};
use serde_json::{Map, Value, json};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

const BACKUP_FORMAT: &str = "eventpulse-backup";
const BACKUP_VERSION: u64 = 1;

fn backup_value(value: ValueRef<'_>) -> rusqlite::Result<Value> {
    Ok(match value {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(value) => json!(value),
        ValueRef::Real(value) => json!(value),
        ValueRef::Text(value) => json!(String::from_utf8_lossy(value).to_string()),
        ValueRef::Blob(value) => json!({ "$binary": STANDARD.encode(value) }),
    })
}

fn row_value(value: &Value) -> Result<SqlValue, String> {
    Ok(match value {
        Value::Null => SqlValue::Null,
        Value::Bool(value) => SqlValue::Integer(i64::from(*value)),
        Value::Number(value) => {
            if let Some(number) = value.as_i64() {
                SqlValue::Integer(number)
            } else if let Some(number) = value.as_f64() {
                SqlValue::Real(number)
            } else {
                return Err("The backup contains an invalid number.".to_string());
            }
        }
        Value::String(value) => SqlValue::Text(value.clone()),
        Value::Object(value)
            if value.len() == 1 && value.get("$binary").and_then(Value::as_str).is_some() =>
        {
            let encoded = value["$binary"].as_str().unwrap_or_default();
            SqlValue::Blob(
                STANDARD
                    .decode(encoded)
                    .map_err(|_| "The backup contains invalid binary data.".to_string())?,
            )
        }
        _ => return Err("The backup contains an invalid database value.".to_string()),
    })
}

fn table_names(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    let mut statement = conn.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )?;
    let rows = statement.query_map([], |row| row.get(0))?;
    rows.collect()
}

fn table_columns(conn: &Connection, table: &str) -> rusqlite::Result<Vec<String>> {
    let mut statement = conn.prepare(&format!(
        "PRAGMA table_info(\"{}\")",
        table.replace('"', "\"\"")
    ))?;
    let rows = statement.query_map([], |row| row.get(1))?;
    rows.collect()
}

fn create_backup_json(conn: &Connection, app_data: &Path) -> Result<Value, String> {
    let mut tables = Map::new();
    let mut files = Vec::new();
    let upload_root = app_data.join("uploads");

    for table in table_names(conn).map_err(|e| e.to_string())? {
        let columns = table_columns(conn, &table).map_err(|e| e.to_string())?;
        let mut statement = conn
            .prepare(&format!("SELECT * FROM \"{}\"", table.replace('"', "\"\"")))
            .map_err(|e| e.to_string())?;
        let mut rows = statement.query([]).map_err(|e| e.to_string())?;
        let mut table_rows = Vec::new();
        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let mut object = Map::new();
            for (index, column) in columns.iter().enumerate() {
                object.insert(
                    column.clone(),
                    backup_value(row.get_ref(index).map_err(|e| e.to_string())?)
                        .map_err(|e| e.to_string())?,
                );
            }
            if table == "event_files" {
                if let Some(storage_key) = object.get("storage_key").and_then(Value::as_str) {
                    if !storage_key.starts_with("remote-pending:") {
                        let path = PathBuf::from(storage_key);
                        let key = path
                            .strip_prefix(&upload_root)
                            .map_err(|_| {
                                "An uploaded file is outside the application storage directory."
                                    .to_string()
                            })?
                            .to_string_lossy()
                            .replace('\\', "/");
                        let bytes = std::fs::read(&path)
                            .map_err(|e| format!("Could not back up an uploaded file: {e}"))?;
                        files.push(json!({ "key": key, "data": STANDARD.encode(bytes) }));
                        object.insert(
                            "storage_key".to_string(),
                            Value::String(format!("uploads/{key}")),
                        );
                    }
                }
            }
            table_rows.push(Value::Object(object));
        }
        tables.insert(table, Value::Array(table_rows));
    }

    Ok(json!({
        "format": BACKUP_FORMAT,
        "source": "desktop",
        "version": BACKUP_VERSION,
        "createdAt": chrono::Utc::now().to_rfc3339(),
        "tables": Value::Object(tables),
        "files": files,
    }))
}

#[tauri::command]
pub fn create_backup(app: AppHandle, state: State<'_, DbState>) -> CommandResult<String> {
    let conn = match state.conn() {
        Ok(conn) => conn,
        Err(error) => return CommandResult::err(&format!("Database error: {error}")),
    };
    let app_data = match app.path().app_data_dir() {
        Ok(path) => path,
        Err(error) => {
            return CommandResult::err(&format!("Could not locate application data: {error}"));
        }
    };
    match create_backup_json(&conn, &app_data)
        .and_then(|backup| serde_json::to_string(&backup).map_err(|e| e.to_string()))
    {
        Ok(backup) => CommandResult::ok(backup),
        Err(error) => CommandResult::err(&format!("Could not create full backup: {error}")),
    }
}

fn portable_upload_key(reference: &str) -> Option<String> {
    let normalized = reference.replace('\\', "/");
    let path = if let Some(url) = normalized.strip_prefix("https://") {
        let (_, path) = url.split_once('/')?;
        path.split(['?', '#']).next()?.to_string()
    } else {
        normalized.trim_start_matches('/').to_string()
    };
    let relative = path.strip_prefix("uploads/").or_else(|| {
        path.rfind("/uploads/").map(|index| &path[index + "/uploads/".len()..])
    })?;
    if relative.is_empty() || relative.split('/').any(|part| part.is_empty() || part == "." || part == "..")
        || !relative.bytes().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'/' | b'.' | b'_' | b'-'))
    {
        return None;
    }
    Some(relative.to_string())
}

fn validate_backup(backup: &mut Value, conn: &Connection) -> Result<(), String> {
    let format = backup.get("format").and_then(Value::as_str);
    if (format != Some(BACKUP_FORMAT) && format != Some("eventpulse-desktop-backup") && format != Some("eventpulse-web-backup"))
        || backup.get("version").and_then(Value::as_u64) != Some(BACKUP_VERSION)
    {
        return Err("This is not a supported EventPulse desktop backup.".to_string());
    }
    let source_name = backup.get("source").and_then(Value::as_str).or_else(|| {
        match format {
            Some("eventpulse-web-backup") => Some("web"),
            Some("eventpulse-desktop-backup") => Some("desktop"),
            _ => None,
        }
    });
    let source_tables = backup
        .get("tables")
        .and_then(Value::as_object)
        .ok_or("The backup has no database tables.")?;
    let source_files = backup
        .get("files")
        .and_then(Value::as_array)
        .ok_or("The backup has no attachment list.")?;
    let existing_names = table_names(conn).map_err(|e| e.to_string())?;
    let mut adapted_tables = Map::new();
    for table in &existing_names {
        let columns: HashSet<String> = table_columns(conn, table)
            .map_err(|e| e.to_string())?
            .into_iter()
            .collect();
        let rows = match source_tables.get(table) {
            Some(value) => value.as_array().cloned().ok_or("The backup contains an invalid table.")?,
            None => Vec::new(),
        };
        let mut adapted_rows = Vec::new();
        for row in rows {
            let object = row.as_object().ok_or("The backup contains an invalid database row.")?;
            adapted_rows.push(Value::Object(object.iter()
                .filter(|(column, _)| columns.contains(*column))
                .map(|(column, value)| (column.clone(), value.clone()))
                .collect()));
        }
        adapted_tables.insert(table.clone(), Value::Array(adapted_rows));
    }

    let mut adapted_files = Vec::new();
    for file in source_files {
        let key = file.get("key").and_then(Value::as_str).ok_or("The backup contains an invalid attachment.")?;
        let relative = portable_upload_key(key).or_else(|| {
            (source_name == Some("desktop")
                && !key.is_empty()
                && key.split(['/', '\\']).all(|part| !part.is_empty() && part != "." && part != "..")
                && key.bytes().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'/' | b'\\' | b'.' | b'_' | b'-')))
                .then(|| key.replace('\\', "/"))
        });
        let Some(relative) = relative else { continue };
        adapted_files.push(json!({ "key": relative, "data": file.get("data").and_then(Value::as_str).unwrap_or_default() }));
    }
    if let Some(event_files) = adapted_tables.get_mut("event_files").and_then(Value::as_array_mut) {
        for row in event_files {
            let Some(reference) = row.get("storage_key").and_then(Value::as_str) else { continue };
            if reference.starts_with("remote-pending:") || reference.starts_with("sync-pending:") { continue; }
            let Some(relative) = portable_upload_key(reference) else {
                if source_name == Some("web") { continue; }
                return Err("This backup contains a file path outside the uploads directory.".to_string());
            };
            row["storage_key"] = Value::String(format!("uploads/{relative}"));
        }
    }
    if let Some(users) = adapted_tables.get_mut("users").and_then(Value::as_array_mut) {
        if source_name == Some("web") {
            for row in users {
                if row.get("avatar_url").and_then(Value::as_str).is_some_and(|avatar| avatar.starts_with("/api/avatars/")) {
                    row["avatar_url"] = Value::Null;
                }
            }
        }
    }
    backup["tables"] = Value::Object(adapted_tables);
    backup["files"] = Value::Array(adapted_files);
    let tables = backup["tables"].as_object().unwrap();
    let files = backup["files"].as_array().unwrap();
    for rows in tables.values() {
        if !rows.is_array() {
            return Err("The backup contains an invalid table.".to_string());
        }
    }
    let mut file_keys = HashSet::new();
    for file in files {
        let key = file
            .get("key")
            .and_then(Value::as_str)
            .ok_or("The backup contains an invalid attachment.")?;
        if key.is_empty()
            || Path::new(key).is_absolute()
            || !key.bytes().all(|byte| {
                byte.is_ascii_alphanumeric() || matches!(byte, b'/' | b'\\' | b'.' | b'_' | b'-')
            })
            || key
                .split(['/', '\\'])
                .any(|part| part.is_empty() || part == "." || part == "..")
            || !file_keys.insert(key.replace('\\', "/").to_lowercase())
        {
            return Err("The backup contains an unsafe or duplicate attachment path.".to_string());
        }
        let data = file
            .get("data")
            .and_then(Value::as_str)
            .ok_or("The backup contains invalid attachment data.")?;
        STANDARD
            .decode(data)
            .map_err(|_| "The backup contains invalid attachment data.".to_string())?;
    }
    if let Some(event_files) = tables.get("event_files").and_then(Value::as_array) {
        for row in event_files {
            let storage_key = row
                .get("storage_key")
                .and_then(Value::as_str)
                .ok_or("The backup contains an invalid file record.")?;
            if storage_key.starts_with("remote-pending:") || storage_key.starts_with("sync-pending:") {
                continue;
            }
            let normalized = storage_key.replace('\\', "/");
            let relative = normalized
                .strip_prefix("uploads/")
                .or_else(|| {
                    normalized
                        .rfind("/uploads/")
                        .map(|index| &normalized[index + "/uploads/".len()..])
                })
                .ok_or("The backup contains a file path outside the uploads directory.")?;
            if relative.is_empty()
                || relative
                    .split('/')
                    .any(|part| part.is_empty() || part == "." || part == "..")
                || !file_keys.contains(&relative.to_lowercase())
            {
                return Err("The backup is missing an uploaded file.".to_string());
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn restore_backup(
    app: AppHandle,
    state: State<'_, DbState>,
    backup_json: String,
) -> CommandResult<bool> {
    let mut backup: Value = match serde_json::from_str(&backup_json) {
        Ok(backup) => backup,
        Err(_) => return CommandResult::err("Choose a valid EventPulse backup file."),
    };
    let app_data = match app.path().app_data_dir() {
        Ok(path) => path,
        Err(error) => {
            return CommandResult::err(&format!("Could not locate application data: {error}"));
        }
    };
    let conn = match state.conn() {
        Ok(conn) => conn,
        Err(error) => return CommandResult::err(&format!("Database error: {error}")),
    };
    if let Err(error) = validate_backup(&mut backup, &conn) {
        return CommandResult::err(&error);
    }

    let restore_id = Uuid::new_v4().to_string();
    let upload_root = app_data.join("uploads");
    let restored_uploads = app_data.join(format!(".uploads-restore-{restore_id}"));
    let previous_uploads = app_data.join(format!(".uploads-backup-{restore_id}"));
    if let Err(error) = std::fs::create_dir_all(&restored_uploads) {
        return CommandResult::err(&format!("Could not prepare restored attachments: {error}"));
    }
    let files = backup["files"].as_array().unwrap();
    let mut restored_paths = HashMap::new();
    for file in files {
        let key = file["key"].as_str().unwrap();
        let destination = restored_uploads.join(key);
        if let Some(parent) = destination.parent() {
            if let Err(error) = std::fs::create_dir_all(parent) {
                let _ = std::fs::remove_dir_all(&restored_uploads);
                return CommandResult::err(&format!(
                    "Could not prepare restored attachments: {error}"
                ));
            }
        }
        let bytes = match STANDARD.decode(file["data"].as_str().unwrap_or_default()) {
            Ok(bytes) => bytes,
            Err(_) => {
                let _ = std::fs::remove_dir_all(&restored_uploads);
                return CommandResult::err("The backup contains invalid attachment data.");
            }
        };
        if let Err(error) = std::fs::write(&destination, bytes) {
            let _ = std::fs::remove_dir_all(&restored_uploads);
            return CommandResult::err(&format!("Could not restore an attachment: {error}"));
        }
        let restored_path = upload_root.join(key).to_string_lossy().to_string();
        restored_paths.insert(format!("uploads/{key}"), restored_path.clone());
        restored_paths.insert(key.replace('\\', "/"), restored_path);
    }

    let had_previous_uploads = upload_root.exists();
    if had_previous_uploads {
        if let Err(error) = std::fs::rename(&upload_root, &previous_uploads) {
            let _ = std::fs::remove_dir_all(&restored_uploads);
            return CommandResult::err(&format!(
                "Could not safely replace existing attachments: {error}"
            ));
        }
    }
    if let Err(error) = std::fs::rename(&restored_uploads, &upload_root) {
        if had_previous_uploads {
            let _ = std::fs::rename(&previous_uploads, &upload_root);
        }
        let _ = std::fs::remove_dir_all(&restored_uploads);
        return CommandResult::err(&format!("Could not install restored attachments: {error}"));
    }

    let result = (|| -> Result<(), String> {
        let tables = backup["tables"]
            .as_object()
            .ok_or("The backup has no tables.")?;
        let names = table_names(&conn).map_err(|e| e.to_string())?;
        let tx_conn = conn;
        let mut tx_conn = tx_conn;
        tx_conn
            .execute_batch("PRAGMA foreign_keys=OFF")
            .map_err(|e| e.to_string())?;
        let restore_result = (|| -> Result<(), String> {
            let transaction = tx_conn.transaction().map_err(|e| e.to_string())?;
            for table in names.iter().rev() {
                transaction
                    .execute(
                        &format!("DELETE FROM \"{}\"", table.replace('"', "\"\"")),
                        [],
                    )
                    .map_err(|e| e.to_string())?;
            }
            for table in &names {
                let rows = tables
                    .get(table)
                    .and_then(Value::as_array)
                    .ok_or_else(|| format!("The backup is missing table {table}."))?;
                let columns = table_columns(&transaction, table).map_err(|e| e.to_string())?;
                for row in rows {
                    let object = row
                        .as_object()
                        .ok_or("The backup contains an invalid database row.")?;
                    let mut keys: Vec<&String> = object.keys().collect();
                    keys.sort();
                    let mut values = Vec::new();
                    for key in &keys {
                        let mut value = row_value(&object[*key])?;
                        if table == "event_files" && key.as_str() == "storage_key" {
                            if let SqlValue::Text(reference) = &value {
                                let normalized = reference.replace('\\', "/");
                                let portable = normalized
                                    .strip_prefix("uploads/")
                                    .map(str::to_string)
                                    .or_else(|| {
                                        normalized.rfind("/uploads/").map(|index| {
                                            normalized[index + "/uploads/".len()..].to_string()
                                        })
                                    });
                                let mapped = restored_paths.get(reference).or_else(|| {
                                    portable.as_ref().and_then(|key| restored_paths.get(key))
                                });
                                if let Some(mapped) = mapped {
                                    value = SqlValue::Text(mapped.clone());
                                }
                            }
                        }
                        values.push(value);
                    }
                    if keys.is_empty() {
                        continue;
                    }
                    let sql = format!(
                        "INSERT INTO \"{}\" ({}) VALUES ({})",
                        table.replace('"', "\"\""),
                        keys.iter()
                            .map(|key| format!("\"{}\"", key.replace('"', "\"\"")))
                            .collect::<Vec<_>>()
                            .join(","),
                        vec!["?"; keys.len()].join(",")
                    );
                    if keys.iter().any(|key| !columns.contains(key)) {
                        return Err("The backup contains unsupported database columns.".to_string());
                    }
                    transaction
                        .execute(&sql, params_from_iter(values))
                        .map_err(|e| format!("Could not restore {table}: {e}"))?;
                }
            }
            transaction.commit().map_err(|e| e.to_string())?;
            Ok(())
        })();
        let _ = tx_conn.execute_batch("PRAGMA foreign_keys=ON");
        restore_result
    })();

    if let Err(error) = result {
        let _ = std::fs::remove_dir_all(&upload_root);
        if had_previous_uploads {
            let _ = std::fs::rename(&previous_uploads, &upload_root);
        }
        return CommandResult::err(&format!("Could not restore backup: {error}"));
    }

    if had_previous_uploads {
        let _ = std::fs::remove_dir_all(&previous_uploads);
    }
    CommandResult::ok(true)
}
