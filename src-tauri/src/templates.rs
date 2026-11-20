use crate::db::DbState;
use crate::types::{CommandResult, CreateTemplateInput, Template};
use rusqlite::{OptionalExtension, params};
use tauri::State;
use uuid::Uuid;

fn builtin_templates() -> Vec<Template> {
    vec![
        Template {
            id: "tech-conference".to_string(),
            name: "Tech Innovation Conference".to_string(),
            category: "Conference".to_string(),
            description: "A full-day flagship event featuring keynote addresses, multi-track breakout sessions, sponsor booths, and an evening networking mixer.".to_string(),
            default_venue: "Grand Convention Center, Hall A".to_string(),
            default_capacity: Some(500),
            default_duration_minutes: 480,
            gradient: "from-indigo-500 via-indigo-600 to-purple-600".to_string(),
            badge: "Most popular".to_string(),
            agenda_presets: vec![
                serde_json::json!({"title":"Registration & Morning Coffee","durationMinutes":45,"description":"Badge pickup and breakfast."}),
                serde_json::json!({"title":"Opening Keynote","durationMinutes":60,"description":"Welcome and keynote address."}),
                serde_json::json!({"title":"Networking Reception","durationMinutes":60,"description":"Meet fellow attendees."}),
            ],
            task_presets: vec![
                serde_json::json!({"title":"Confirm speakers","notes":"Finalize speaker details and presentations."}),
                serde_json::json!({"title":"Arrange catering","notes":"Confirm dietary requirements and headcount."}),
                serde_json::json!({"title":"Test AV equipment","notes":"Check microphones, screens and connectivity."}),
            ],
            owner_id: None,
            is_custom: false,
        },
        Template {
            id: "product-launch".to_string(),
            name: "Product Launch Showcase".to_string(),
            category: "Webinar".to_string(),
            description: "An energetic reveal event tailored for press, VIP customers and ambassadors with live stage demos, Q&A, and media briefings.".to_string(),
            default_venue: "Metropolitan Theater & Studio".to_string(),
            default_capacity: Some(250),
            default_duration_minutes: 180,
            gradient: "from-rose-500 via-orange-500 to-amber-500".to_string(),
            badge: "High impact".to_string(),
            agenda_presets: vec![
                serde_json::json!({"title":"Doors Open & Press Check-in","durationMinutes":30,"description":"Media check-in and welcome."}),
                serde_json::json!({"title":"The Big Reveal","durationMinutes":45,"description":"Product announcement and presentation."}),
                serde_json::json!({"title":"Live Product Demo","durationMinutes":30,"description":"Demonstrate the new product."}),
                serde_json::json!({"title":"Press Q&A","durationMinutes":30,"description":"Questions and answers."}),
            ],
            task_presets: vec![
                serde_json::json!({"title":"Prepare press kit","notes":"Gather product specs, images and pricing."}),
                serde_json::json!({"title":"Set up demo units","notes":"Install the release build and test."}),
                serde_json::json!({"title":"Arrange refreshments","notes":"Confirm catering for guests."}),
            ],
            owner_id: None,
            is_custom: false,
        },
    ]
}

fn stored_template(row: &rusqlite::Row<'_>) -> rusqlite::Result<Template> {
    let structure: String = row.get(8)?;
    let structure: serde_json::Value = serde_json::from_str(&structure).unwrap_or_default();
    let owner_id: Option<String> = row.get(1)?;
    let is_custom = owner_id.is_some();
    Ok(Template {
        id: row.get(0)?,
        owner_id,
        name: row.get(2)?,
        category: row.get(3)?,
        description: row.get(4)?,
        default_venue: row.get(5)?,
        default_capacity: row.get(6)?,
        default_duration_minutes: row.get(7)?,
        gradient: "from-copper-500 via-copper-600 to-copper-700".to_string(),
        badge: if is_custom { "Custom" } else { "Built-in" }.to_string(),
        agenda_presets: structure
            .get("agendaPresets")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default(),
        task_presets: structure
            .get("taskPresets")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default(),
        is_custom,
    })
}

#[tauri::command]
pub fn list_templates(state: State<'_, DbState>, user_id: String) -> CommandResult<Vec<Template>> {
    let conn = match state.conn() {
        Ok(c) => c,
        Err(e) => return CommandResult::err(&format!("Database error: {e}")),
    };
    let mut stmt = match conn.prepare(
        "SELECT id, owner_id, name, category, description, default_venue, default_capacity, default_duration_minutes, structure_json FROM event_templates WHERE owner_id = ?1 OR owner_id IS NULL ORDER BY owner_id DESC, created_at DESC",
    ) {
        Ok(s) => s,
        Err(e) => return CommandResult::err(&format!("Database error: {e}")),
    };
    let rows = match stmt.query_map(params![user_id], stored_template) {
        Ok(rows) => rows,
        Err(e) => return CommandResult::err(&format!("Database error: {e}")),
    };
    let mut templates = match rows.collect::<Result<Vec<_>, _>>() {
        Ok(templates) => templates,
        Err(e) => return CommandResult::err(&format!("Database error: {e}")),
    };
    if !templates.iter().any(|template| template.owner_id.is_none()) {
        templates.extend(builtin_templates());
    }
    CommandResult::ok(templates)
}

#[tauri::command]
pub fn create_template(
    state: State<'_, DbState>,
    user_id: String,
    input: CreateTemplateInput,
) -> CommandResult<Template> {
    let conn = match state.conn() {
        Ok(c) => c,
        Err(e) => return CommandResult::err(&format!("Database error: {e}")),
    };
    let role = conn
        .query_row(
            "SELECT workspace_role FROM users WHERE id=?1",
            params![user_id],
            |row| row.get::<_, String>(0),
        )
        .optional();
    match role {
        Ok(Some(_)) => {}
        Ok(None) => return CommandResult::err("User not found."),
        Err(e) => return CommandResult::err(&format!("Database error: {e}")),
    }
    let name = input.name.trim();
    if name.is_empty() || name.len() > 100 {
        return CommandResult::err("Template name must be between 1 and 100 characters.");
    }
    if input.category.trim().is_empty() {
        return CommandResult::err("Choose a template category.");
    }
    if input.agenda_presets.len() > 100 || input.task_presets.len() > 100 {
        return CommandResult::err("A template can contain at most 100 sessions and 100 tasks.");
    }
    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let structure = serde_json::json!({ "agendaPresets": input.agenda_presets, "taskPresets": input.task_presets });
    if let Err(e) = conn.execute(
        "INSERT INTO event_templates (id,owner_id,name,category,description,default_venue,default_capacity,default_duration_minutes,structure_json,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
        params![id,user_id,name,input.category.trim(),input.description.trim(),input.default_venue.trim(),input.default_capacity,input.default_duration_minutes.clamp(15, 1440),structure.to_string(),now],
    ) {
        return CommandResult::err(&format!("Could not save template: {e}"));
    }
    match conn.query_row(
        "SELECT id,owner_id,name,category,description,default_venue,default_capacity,default_duration_minutes,structure_json FROM event_templates WHERE id=?1",
        params![id], stored_template,
    ) {
        Ok(template) => CommandResult::ok(template),
        Err(e) => CommandResult::err(&format!("Could not load saved template: {e}")),
    }
}
