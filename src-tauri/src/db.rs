use crate::types::CommandResult;
use chrono::Utc;
use rusqlite::{Connection, params};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;
use tauri::{AppHandle, Manager};

pub struct DbState(pub Mutex<Option<PathBuf>>);

impl DbState {
    pub fn conn(&self) -> rusqlite::Result<Connection> {
        let guard = self.0.lock().unwrap();
        match guard.as_ref() {
            Some(path) => Connection::open(path),
            None => Err(rusqlite::Error::InvalidQuery),
        }
    }
}

pub fn data_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Could not locate the application data directory: {e}"))?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Could not create application data directory: {e}"))?;
    let path = dir.join("eventpulse.db");

    // Older builds stored the SQLite database under the OS temp directory.
    // Checkpoint it before copying so committed WAL data is preserved.
    let legacy = std::env::temp_dir()
        .join("eventmanagerdesktop")
        .join("eventpulse.db");
    if !path.exists() && legacy.exists() {
        let legacy_conn = Connection::open(&legacy)
            .map_err(|e| format!("Could not open the existing database for migration: {e}"))?;
        legacy_conn
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
            .map_err(|e| format!("Could not checkpoint the existing database: {e}"))?;
        drop(legacy_conn);
        std::fs::copy(&legacy, &path)
            .map_err(|e| format!("Could not migrate the existing database: {e}"))?;
    }
    Ok(path)
}

/// Opens (or creates) the database, applies migrations and seeds built-in
/// templates. Returns the database path on success.
pub fn initialize(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let path = data_dir(app_handle)?;
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;
    ensure_db(&conn).map_err(|e| e.to_string())?;
    Ok(path)
}

#[tauri::command]
pub fn init_db(app: AppHandle, state: State<'_, DbState>) -> CommandResult<String> {
    let mut database_path = state.0.lock().unwrap();
    if let Some(path) = database_path.as_ref() {
        return CommandResult::ok(path.to_string_lossy().to_string());
    }

    match initialize(&app) {
        Ok(path) => {
            *database_path = Some(path.clone());
            CommandResult::ok(path.to_string_lossy().to_string())
        }
        Err(e) => CommandResult::err(&format!("Database error: {e}")),
    }
}

fn ensure_db(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")?;

    let migrations: &[&str] = &[
        r#"
        CREATE TABLE IF NOT EXISTS eventpulse_backup_archive (
          table_name TEXT PRIMARY KEY,
          rows_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT NOT NULL UNIQUE,
          provider TEXT NOT NULL DEFAULT 'password',
          password_hash TEXT,
          google_sub TEXT,
          avatar_url TEXT,
          workspace_role TEXT NOT NULL DEFAULT 'member',
          created_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub_unique
          ON users (google_sub) WHERE google_sub IS NOT NULL;
        "#,
        r#"
        CREATE TABLE IF NOT EXISTS events (
          id TEXT PRIMARY KEY,
          owner_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          category TEXT NOT NULL DEFAULT 'Other',
          venue TEXT NOT NULL DEFAULT '',
          starts_at TEXT NOT NULL,
          capacity INTEGER,
          visibility TEXT NOT NULL DEFAULT 'private',
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS events_owner_starts_idx
          ON events (owner_id, starts_at);
        "#,
        r#"
        CREATE TABLE IF NOT EXISTS event_members (
          id TEXT PRIMARY KEY,
          event_id TEXT NOT NULL REFERENCES events (id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
          role TEXT NOT NULL DEFAULT 'member',
          invited_by TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
          invited_at TEXT NOT NULL DEFAULT (datetime('now')),
          status TEXT NOT NULL DEFAULT 'pending',
          UNIQUE (event_id, user_id)
        );
        "#,
        r#"
        CREATE TABLE IF NOT EXISTS user_preferences (
          user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
          event_reminders INTEGER NOT NULL DEFAULT 1,
          email_updates INTEGER NOT NULL DEFAULT 1,
          weekly_digest INTEGER NOT NULL DEFAULT 0,
          default_capacity INTEGER,
          updated_at TEXT NOT NULL
        );
        "#,
        r#"
        CREATE TABLE IF NOT EXISTS event_activity (
          id TEXT PRIMARY KEY,
          event_id TEXT NOT NULL REFERENCES events (id) ON DELETE SET NULL,
          actor_id TEXT REFERENCES users (id) ON DELETE SET NULL,
          kind TEXT NOT NULL,
          summary TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS event_activity_event_created_idx
          ON event_activity (event_id, created_at);
        "#,
        r#"
        CREATE TABLE IF NOT EXISTS event_notifications (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
          event_id TEXT REFERENCES events (id) ON DELETE SET NULL,
          kind TEXT NOT NULL,
          title TEXT NOT NULL,
          message TEXT NOT NULL,
          link_url TEXT NOT NULL DEFAULT '',
          read_at TEXT,
          created_at TEXT NOT NULL
        );
        "#,
        r#"
        CREATE TABLE IF NOT EXISTS event_notifications (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
          event_id TEXT REFERENCES events (id) ON DELETE SET NULL,
          kind TEXT NOT NULL,
          title TEXT NOT NULL,
          message TEXT NOT NULL DEFAULT '',
          link_url TEXT NOT NULL DEFAULT '',
          read_at TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS event_notifications_user_created_idx ON event_notifications (user_id, created_at);

        CREATE TABLE IF NOT EXISTS event_templates (
          id TEXT PRIMARY KEY,
          owner_id TEXT REFERENCES users (id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          category TEXT NOT NULL DEFAULT 'Other',
          description TEXT NOT NULL DEFAULT '',
          default_venue TEXT NOT NULL DEFAULT '',
          default_capacity INTEGER,
          default_duration_minutes INTEGER NOT NULL DEFAULT 60,
          structure_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS event_templates_owner_idx
          ON event_templates (owner_id);
        "#,
        r#"
        CREATE TABLE IF NOT EXISTS event_tasks (
          id TEXT PRIMARY KEY,
          event_id TEXT NOT NULL REFERENCES events (id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          notes TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'open',
          assignee_id TEXT REFERENCES users (id) ON DELETE SET NULL,
          due_at TEXT,
          created_by TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS event_tasks_event_created_idx ON event_tasks (event_id, created_at);

        CREATE TABLE IF NOT EXISTS event_agenda_items (
          id TEXT PRIMARY KEY,
          event_id TEXT NOT NULL REFERENCES events (id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          starts_at TEXT NOT NULL,
          duration_minutes INTEGER NOT NULL DEFAULT 30,
          location TEXT NOT NULL DEFAULT '',
          speaker_name TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'scheduled',
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS event_agenda_event_idx ON event_agenda_items (event_id, starts_at);

        CREATE TABLE IF NOT EXISTS event_files (
          id TEXT PRIMARY KEY,
          event_id TEXT NOT NULL REFERENCES events (id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
          size_bytes INTEGER NOT NULL,
          storage_key TEXT NOT NULL UNIQUE,
          uploaded_by TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS event_files_event_created_idx ON event_files (event_id, created_at);

        CREATE TABLE IF NOT EXISTS sync_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          website_url TEXT NOT NULL DEFAULT '',
          token TEXT NOT NULL DEFAULT '',
          device_id TEXT NOT NULL DEFAULT '',
          local_user_id TEXT NOT NULL DEFAULT '',
          paired_account_email TEXT NOT NULL DEFAULT '',
          last_pull_seq INTEGER NOT NULL DEFAULT 0,
          last_sync_at TEXT,
          last_error TEXT
        );

        CREATE TABLE IF NOT EXISTS sync_outbox (
          seq INTEGER PRIMARY KEY AUTOINCREMENT,
          change_id TEXT NOT NULL,
          action TEXT NOT NULL,
          event_id TEXT NOT NULL,
          payload TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sync_notification_read_outbox (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          notification_id TEXT,
          mark_all INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS work_sync_outbox (
          seq INTEGER PRIMARY KEY AUTOINCREMENT,
          kind TEXT NOT NULL,
          action TEXT NOT NULL,
          event_id TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          payload TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS work_sync_outbox_created_idx
          ON work_sync_outbox (created_at);
        CREATE TABLE IF NOT EXISTS work_sync_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          initial_seeded INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS sync_preferences_outbox (
          user_id TEXT PRIMARY KEY,
          payload TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS sync_notification_read_user_idx
          ON sync_notification_read_outbox (user_id, created_at);



        CREATE TABLE IF NOT EXISTS synced_event_members (
          id TEXT PRIMARY KEY,
          event_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          name TEXT NOT NULL,
          email TEXT NOT NULL,
          avatar_url TEXT,
          role TEXT NOT NULL,
          invited_at TEXT NOT NULL,
          status TEXT NOT NULL,
          UNIQUE (event_id, user_id)
        );
        CREATE INDEX IF NOT EXISTS synced_event_members_event_idx
          ON synced_event_members (event_id, invited_at);

        CREATE TABLE IF NOT EXISTS synced_invitations (
          id TEXT PRIMARY KEY,
          event_id TEXT NOT NULL,
          email TEXT NOT NULL,
          role TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          event_title TEXT NOT NULL,
          starts_at TEXT NOT NULL,
          venue TEXT NOT NULL DEFAULT '',
          category TEXT NOT NULL DEFAULT 'Other',
          inviter_name TEXT
        );
        CREATE INDEX IF NOT EXISTS synced_invitations_status_created_idx
          ON synced_invitations (status, created_at DESC);

        CREATE TABLE IF NOT EXISTS synced_shared_events (
          id TEXT PRIMARY KEY,
          paired_user_id TEXT NOT NULL,
          owner_id TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          category TEXT NOT NULL DEFAULT 'Other',
          venue TEXT NOT NULL DEFAULT '',
          starts_at TEXT NOT NULL,
          capacity INTEGER,
          visibility TEXT NOT NULL DEFAULT 'private',
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS synced_shared_events_user_starts_idx
          ON synced_shared_events (paired_user_id, starts_at);
        "#,
    ];

    for migration in migrations {
        conn.execute_batch(migration)?;
    }

    ensure_column(
        conn,
        "event_tasks",
        "updated_at",
        "TEXT NOT NULL DEFAULT ''",
    )?;
    ensure_column(
        conn,
        "event_agenda_items",
        "updated_at",
        "TEXT NOT NULL DEFAULT ''",
    )?;
    ensure_column(
        conn,
        "event_files",
        "updated_at",
        "TEXT NOT NULL DEFAULT ''",
    )?;
    conn.execute_batch(
        "UPDATE event_tasks SET updated_at = created_at WHERE updated_at = '';\
         UPDATE event_agenda_items SET updated_at = created_at WHERE updated_at = '';\
         UPDATE event_files SET updated_at = created_at WHERE updated_at = '';",
    )?;

    seed_builtin_templates(conn)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::ensure_db;
    use rusqlite::Connection;

    #[test]
    fn database_initialization_is_repeatable_and_seeds_templates_once() {
        let conn = Connection::open_in_memory().expect("open in-memory database");
        ensure_db(&conn).expect("initial schema and seed");
        ensure_db(&conn).expect("repeat initialization");

        let templates: i32 = conn
            .query_row("SELECT COUNT(*) FROM event_templates", [], |row| row.get(0))
            .expect("count templates");
        assert_eq!(templates, 3);

        let tables: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('users', 'events', 'sync_state', 'sync_outbox', 'work_sync_outbox', 'work_sync_state')",
                [],
                |row| row.get(0),
            )
            .expect("count required tables");
        assert_eq!(tables, 6);

        let updated_at_columns: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('event_tasks') WHERE name='updated_at'",
                [],
                |row| row.get(0),
            )
            .expect("check work sync timestamps");
        assert_eq!(updated_at_columns, 1);
    }
}

fn ensure_column(
    conn: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> rusqlite::Result<()> {
    let mut statement = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let columns = statement.query_map([], |row| row.get::<_, String>(1))?;
    for existing in columns {
        if existing? == column {
            return Ok(());
        }
    }
    conn.execute_batch(&format!(
        "ALTER TABLE {table} ADD COLUMN {column} {definition}"
    ))
}

fn seed_builtin_templates(conn: &Connection) -> rusqlite::Result<()> {
    let now = Utc::now().to_rfc3339();
    let count: i32 = conn
        .prepare("SELECT COUNT(*) FROM event_templates")?
        .query_row([], |row| row.get(0))?;
    if count > 0 {
        return Ok(());
    }

    let conference = serde_json::json!({
        "agendaPresets": [
            {"title": "Registration & Morning Coffee", "durationMinutes": 45, "description": "Badge pickup, welcome swag, and breakfast buffet."},
            {"title": "Opening Keynote", "durationMinutes": 60, "description": "Visionary keynote by industry leadership."},
            {"title": "Track 1: Architecture & Cloud", "durationMinutes": 90, "description": "Deep dive technical presentations and case studies."},
            {"title": "Lunch & Sponsor Exhibition", "durationMinutes": 75, "description": "Catered lunch and product demonstrations."},
            {"title": "Panel Discussion & Q&A", "durationMinutes": 60, "description": "Interactive expert panel debate."},
            {"title": "Networking Drinks & Reception", "durationMinutes": 90, "description": "Casual mixer with drinks and canapés."}
        ],
        "taskPresets": [
            {"title": "Finalize keynote speaker contracts", "notes": "Confirm flight and hotel booking"},
            {"title": "Review catering dietary requirements", "notes": "Check vegan and gluten-free counts"},
            {"title": "Test AV projector and audio mics in Hall A", "notes": "Conduct dry run the day before"},
            {"title": "Print attendee badges and name tags", "notes": "Order lanyard ribbons"}
        ]
    });
    let launch = serde_json::json!({
        "agendaPresets": [
            {"title": "Doors Open & Press Check-in", "durationMinutes": 30, "description": "Media badge distribution and welcome drinks."},
            {"title": "The Big Reveal", "durationMinutes": 45, "description": "Product announcement and keynote presentation."},
            {"title": "Live Product Demo", "durationMinutes": 30, "description": "Hands-on demonstration of the new product."},
            {"title": "Press Q&A", "durationMinutes": 30, "description": "Media questions and answers."},
            {"title": "VIP Reception", "durationMinutes": 60, "description": "Networking with VIP guests and press."}
        ],
        "taskPresets": [
            {"title": "Prepare press kit", "notes": "Include product specs, images, and pricing"},
            {"title": "Send media invitations", "notes": "Target tech journalists and influencers"},
            {"title": "Set up demo units", "notes": "Install latest build and test thoroughly"},
            {"title": "Arrange catering", "notes": "Light refreshments for press area"}
        ]
    });
    let workshop = serde_json::json!({
        "agendaPresets": [
            {"title": "Welcome & Introductions", "durationMinutes": 30, "description": "Meet the facilitator and fellow participants."},
            {"title": "Core Concepts", "durationMinutes": 90, "description": "Foundational theory and key principles."},
            {"title": "Hands-on Lab", "durationMinutes": 120, "description": "Practical exercises with instructor guidance."},
            {"title": "Break", "durationMinutes": 30, "description": "Coffee and refreshments."},
            {"title": "Project Build", "durationMinutes": 90, "description": "Apply concepts to a real project."},
            {"title": "Showcase & Retrospective", "durationMinutes": 60, "description": "Present work and gather feedback."}
        ],
        "taskPresets": [
            {"title": "Prepare workshop materials", "notes": "Handouts, slides, and exercise files"},
            {"title": "Print certificates", "notes": "Completion certificates for attendees"}
        ]
    });

    let mut insert = conn.prepare(
        "INSERT INTO event_templates (id, owner_id, name, category, description, default_venue, default_capacity, default_duration_minutes, structure_json, created_at)
         VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)",
    )?;

    let templates = [
        (
            "tech-conference",
            "Tech Innovation Conference",
            "Conference",
            "A full-day flagship event featuring keynote addresses, multi-track breakout sessions, sponsor booths, and an evening networking mixer.",
            "Grand Convention Center, Hall A",
            500,
            480,
            conference,
        ),
        (
            "product-launch",
            "Product Launch Showcase",
            "Webinar",
            "An energetic reveal event tailored for press, VIP customers, and ambassadors with live stage demos, QA, and media briefings.",
            "Metropolitan Theater & Studio",
            250,
            180,
            launch,
        ),
        (
            "team-workshop",
            "Team Strategy Workshop",
            "Workshop",
            "A collaborative working session for teams to align on goals, plan roadmaps, and build shared understanding.",
            "Training Room B",
            30,
            300,
            workshop,
        ),
    ];

    for (id, name, category, desc, venue, capacity, duration, structure) in templates {
        let structure_str = serde_json::to_string(&structure).unwrap();
        insert.execute(params![
            id,
            name,
            category,
            desc,
            venue,
            capacity,
            duration,
            structure_str,
            now
        ])?;
    }

    Ok(())
}
