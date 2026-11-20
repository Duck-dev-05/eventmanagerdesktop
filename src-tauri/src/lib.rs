//! Event Manager Desktop - Tauri backend
//! Port of Event Manager Website (Next.js) to Tauri + Rust.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod auth;
mod backup;
mod crypto;
mod db;
mod events;
mod google;
mod members;
mod notifications;
mod preferences;
mod sync;
mod templates;
mod types;
mod users;
mod work;
mod work_sync;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(db::DbState(std::sync::Mutex::new(None)))
        .setup(|app| {
            // Let the web UI initialize/migrate the database after the window
            // is ready so a first launch can show its branded loading screen.
            sync::spawn(&app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            db::init_db,
            backup::create_backup,
            backup::restore_backup,
            auth::sign_in,
            auth::sign_up,
            auth::sign_out,
            auth::get_current_user,
            auth::update_profile,
            google::google_sign_in,
            events::list_events,
            events::list_events_flat,
            events::get_event,
            events::create_event,
            events::update_event,
            events::duplicate_event,
            events::delete_event,
            members::list_event_members,
            members::list_synced_event_members,
            members::add_event_member,
            members::remove_event_member,
            events::get_event_activity,
            events::log_event_activity,
            notifications::list_notifications,
            notifications::get_unread_notification_count,
            notifications::mark_notification_read,
            notifications::mark_all_notifications_read,
            users::list_users,
            users::manage_workspace_users,
            work::list_event_tasks,
            work::list_event_task_assignees,
            work::create_event_task,
            work::update_event_task,
            work::set_event_task_status,
            work::delete_event_task,
            work::list_agenda_items,
            work::save_agenda_item,
            work::delete_agenda_item,
            work::list_event_files,
            work::upload_event_file,
            work::download_event_file,
            work::delete_event_file,
            work::rename_event_file,
            work::search_workspace,
            templates::list_templates,
            templates::create_template,
            preferences::get_preferences,
            preferences::update_preferences,
            sync::sync_get_config,
            sync::list_synced_invitations,
            sync::list_synced_shared_events,
            sync::respond_to_synced_invitation,
            sync::manage_synced_event_members,
            sync::send_invitation,
            sync::sync_save_config,
            sync::sync_auto_pair,
            sync::request_password_reset,
            sync::sync_disconnect,
            sync::sync_now,
            sync::sync_manage_profile,
            sync::sync_get_calendar_feed,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
