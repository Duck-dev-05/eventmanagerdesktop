use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionUser {
    pub id: String,
    pub name: String,
    pub email: String,
    pub avatar_url: Option<String>,
    pub workspace_role: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventRecord {
    pub id: String,
    pub owner_id: String,
    pub title: String,
    pub description: String,
    pub category: String,
    pub venue: String,
    pub starts_at: String,
    pub capacity: Option<i32>,
    pub visibility: String,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateEventInput {
    pub title: String,
    pub description: String,
    pub category: String,
    pub venue: String,
    pub starts_at: String,
    pub capacity: Option<i32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateEventInput {
    pub title: String,
    pub description: String,
    pub category: String,
    pub venue: String,
    pub starts_at: String,
    pub capacity: Option<i32>,
    pub visibility: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventListItem {
    pub id: String,
    pub title: String,
    pub month: String,
    pub day: String,
    pub time: String,
    pub venue: String,
    pub capacity: Option<i32>,
    pub status: String,
    pub is_owner: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventMember {
    pub id: String,
    pub event_id: String,
    pub user_id: String,
    pub role: String,
    pub invited_by: String,
    pub invited_at: String,
    pub status: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvitationSendResult {
    pub invite_url: String,
    pub message: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncedInvitation {
    pub id: String,
    pub event_id: String,
    pub email: String,
    pub role: String,
    pub status: String,
    pub created_at: String,
    pub expires_at: String,
    pub event_title: String,
    pub starts_at: String,
    pub venue: String,
    pub category: String,
    pub inviter_name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableEventUser {
    pub id: String,
    pub name: String,
    pub email: String,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncedEventMember {
    pub id: String,
    pub event_id: String,
    pub user_id: String,
    pub name: String,
    pub email: String,
    pub avatar_url: Option<String>,
    pub role: String,
    pub invited_at: String,
    pub status: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddMemberInput {
    pub email: String,
    pub role: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityEntry {
    pub id: String,
    pub kind: String,
    pub summary: String,
    pub created_at: String,
    pub actor_name: Option<String>,
    pub actor_avatar_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogActivityInput {
    pub event_id: String,
    pub actor_id: String,
    pub kind: String,
    pub summary: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Notification {
    pub id: String,
    pub event_id: Option<String>,
    pub kind: String,
    pub title: String,
    pub message: String,
    pub link_url: String,
    pub read_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTemplateInput {
    pub name: String,
    pub category: String,
    pub description: String,
    pub default_venue: String,
    pub default_capacity: Option<i32>,
    pub default_duration_minutes: i32,
    pub agenda_presets: Vec<serde_json::Value>,
    pub task_presets: Vec<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Template {
    pub id: String,
    pub name: String,
    pub category: String,
    pub description: String,
    pub default_venue: String,
    pub default_capacity: Option<i32>,
    pub default_duration_minutes: i32,
    pub gradient: String,
    pub badge: String,
    pub agenda_presets: Vec<serde_json::Value>,
    pub task_presets: Vec<serde_json::Value>,
    pub owner_id: Option<String>,
    pub is_custom: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserRecord {
    pub id: String,
    pub name: String,
    pub email: String,
    pub provider: String,
    pub avatar_url: Option<String>,
    pub workspace_role: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreferenceRecord {
    pub user_id: String,
    pub event_reminders: bool,
    pub email_updates: bool,
    pub weekly_digest: bool,
    pub default_capacity: Option<i32>,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePreferenceInput {
    pub event_reminders: Option<bool>,
    pub email_updates: Option<bool>,
    pub weekly_digest: Option<bool>,
    pub default_capacity: Option<i32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandResult<T> {
    pub success: bool,
    pub data: Option<T>,
    pub error: Option<String>,
}

impl<T> CommandResult<T> {
    pub fn ok(data: T) -> Self {
        CommandResult {
            success: true,
            data: Some(data),
            error: None,
        }
    }

    pub fn err(message: &str) -> Self {
        CommandResult {
            success: false,
            data: None,
            error: Some(message.to_string()),
        }
    }
}
