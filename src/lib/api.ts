import { invoke } from "@tauri-apps/api/core";
import type {
  SessionUser,
  EventRecord,
  EventListItem,
  EventMember,
  SyncedEventMember,
  AvailableEventUser,
  SyncedInvitation,
  ActivityEntry,
  AgendaItem,
  EventFileRecord,
  EventTask,
  TaskAssignee,
  WorkspaceSearchResult,
  Notification,
  Template,
  UserRecord,
  PreferenceRecord,
  SyncConfigInfo,
  InvitationSendResult,
  CommandResult,
} from "../types";

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(cmd, args ?? {});
}

export const api = {
  initDb: () => call<string>("init_db"),

  signIn: (email: string, password: string) =>
    call<CommandResult<SessionUser>>("sign_in", { email, password }),
  signUp: (name: string, email: string, password: string) =>
    call<CommandResult<SessionUser>>("sign_up", { name, email, password }),
  signOut: () => call<CommandResult<boolean>>("sign_out"),
  // `google_sign_in` rejects with a message string instead of returning a CommandResult.
  googleSignIn: async (): Promise<CommandResult<SessionUser>> => {
    try {
      const data = await invoke<SessionUser>("google_sign_in");
      return { success: true, data, error: null };
    } catch (error) {
      return {
        success: false,
        data: null,
        error: typeof error === "string" ? error : String(error),
      };
    }
  },
  getCurrentUser: (userId: string) =>
    call<CommandResult<SessionUser>>("get_current_user", { userId }),
  updateProfile: (userId: string, name: string) =>
    call<CommandResult<SessionUser>>("update_profile", { userId, name }),

  listEvents: (userId: string) =>
    call<CommandResult<EventRecord[]>>("list_events", { userId }),
  listEventsFlat: (userId: string) =>
    call<CommandResult<EventListItem[]>>("list_events_flat", { userId }),
  getEvent: (eventId: string, userId: string) =>
    call<CommandResult<EventRecord>>("get_event", { eventId, userId }),
  createEvent: (userId: string, input: {
    title: string;
    description: string;
    category: string;
    venue: string;
    startsAt: string;
    capacity: number | null;
  }) =>
    call<CommandResult<EventRecord>>("create_event", {
      userId,
      input,
    }),
  updateEvent: (eventId: string, actorId: string, input: {
    title: string;
    description: string;
    category: string;
    venue: string;
    startsAt: string;
    capacity: number | null;
    visibility: string;
  }) =>
    call<CommandResult<boolean>>("update_event", {
      eventId,
      actorId,
      input,
    }),
  deleteEvent: (eventId: string, actorId: string) =>
    call<CommandResult<boolean>>("delete_event", {
      eventId,
      actorId,
    }),
  duplicateEvent: (eventId: string, actorId: string, title: string, startsAt: string) =>
    call<CommandResult<EventRecord>>("duplicate_event", { eventId, actorId, title, startsAt }),

  listEventMembers: (eventId: string, userId: string) =>
    call<CommandResult<EventMember[]>>("list_event_members", { eventId, userId }),
  listSyncedEventMembers: (eventId: string, userId: string) =>
    call<CommandResult<SyncedEventMember[]>>("list_synced_event_members", { eventId, userId }),
  listAvailableEventUsers: (eventId: string, userId: string) =>
    call<CommandResult<AvailableEventUser[]>>("manage_synced_event_members", { eventId, userId, action: "list" }),
  addExistingEventMember: (eventId: string, userId: string, memberId: string, role: string) =>
    call<CommandResult<boolean>>("manage_synced_event_members", { eventId, userId, memberId, role, action: "add", email: null, inviteId: null }),
  manageEventMember: (eventId: string, userId: string, action: string, options: { memberId?: string; role?: string; email?: string; inviteId?: string } = {}) =>
    call<CommandResult<any>>("manage_synced_event_members", { eventId, userId, action, memberId: options.memberId ?? null, role: options.role ?? null, email: options.email ?? null, inviteId: options.inviteId ?? null }),
  addEventMember: (eventId: string, actorId: string, email: string, role: string) =>
    call<CommandResult<EventMember>>("add_event_member", {
      eventId,
      actorId,
      input: { email, role },
    }),
  removeEventMember: (eventId: string, actorId: string, userId: string) =>
    call<CommandResult<boolean>>("remove_event_member", {
      eventId,
      actorId,
      userId,
    }),

  getEventActivity: (eventId: string, userId: string) =>
    call<CommandResult<ActivityEntry[]>>("get_event_activity", { eventId, userId }),
  logEventActivity: (eventId: string, actorId: string, kind: string, summary: string) =>
    call<CommandResult<boolean>>("log_event_activity", {
      input: { eventId, actorId, kind, summary },
    }),

  listSyncedInvitations: (userId: string) =>
    call<CommandResult<SyncedInvitation[]>>("list_synced_invitations", { userId }),
  listSyncedSharedEvents: (userId: string) =>
    call<CommandResult<EventRecord[]>>("list_synced_shared_events", { userId }),
  respondToSyncedInvitation: (userId: string, invitationId: string, response: "accept" | "decline") =>
    call<CommandResult<boolean>>("respond_to_synced_invitation", { userId, invitationId, response }),
  sendInvitation: (userId: string, email: string) =>
    call<CommandResult<InvitationSendResult>>("send_invitation", { userId, email }),
  listNotifications: (userId: string) =>
    call<CommandResult<Notification[]>>("list_notifications", { userId }),
  getUnreadNotificationCount: (userId: string) =>
    call<CommandResult<number>>("get_unread_notification_count", { userId }),
  markNotificationRead: (userId: string, notificationId: string) =>
    call<CommandResult<boolean>>("mark_notification_read", { userId, notificationId }),
  markAllNotificationsRead: (userId: string) =>
    call<CommandResult<boolean>>("mark_all_notifications_read", { userId }),

  listEventTasks: (eventId: string, userId: string) =>
    call<CommandResult<EventTask[]>>("list_event_tasks", { eventId, userId }),
  listEventTaskAssignees: (eventId: string, userId: string) =>
    call<CommandResult<TaskAssignee[]>>("list_event_task_assignees", { eventId, userId }),
  createEventTask: (eventId: string, actorId: string, title: string, notes: string, assigneeId: string | null, dueAt: string | null) =>
    call<CommandResult<EventTask>>("create_event_task", { eventId, actorId, title, notes, assigneeId, dueAt }),
  updateEventTask: (eventId: string, taskId: string, actorId: string, title: string, notes: string, assigneeId: string | null, dueAt: string | null) =>
    call<CommandResult<boolean>>("update_event_task", { eventId, taskId, actorId, title, notes, assigneeId, dueAt }),
  setEventTaskStatus: (eventId: string, taskId: string, actorId: string, status: "open" | "done") =>
    call<CommandResult<boolean>>("set_event_task_status", { eventId, taskId, actorId, status }),
  deleteEventTask: (eventId: string, taskId: string, actorId: string) =>
    call<CommandResult<boolean>>("delete_event_task", { eventId, taskId, actorId }),

  listAgendaItems: (eventId: string, userId: string) =>
    call<CommandResult<AgendaItem[]>>("list_agenda_items", { eventId, userId }),
  saveAgendaItem: (input: { eventId: string; actorId: string; itemId: string | null; title: string; description: string; startsAt: string; durationMinutes: number; location: string; speakerName: string; status: AgendaItem["status"] }) =>
    call<CommandResult<AgendaItem>>("save_agenda_item", input),
  deleteAgendaItem: (eventId: string, actorId: string, itemId: string) =>
    call<CommandResult<boolean>>("delete_agenda_item", { eventId, actorId, itemId }),

  listEventFiles: (eventId: string, userId: string) =>
    call<CommandResult<EventFileRecord[]>>("list_event_files", { eventId, userId }),
  uploadEventFile: (eventId: string, actorId: string, name: string, mimeType: string, dataBase64: string) =>
    call<CommandResult<EventFileRecord>>("upload_event_file", { eventId, actorId, name, mimeType, dataBase64 }),
  downloadEventFile: (eventId: string, userId: string, fileId: string) =>
    call<CommandResult<string>>("download_event_file", { eventId, userId, fileId }),
  deleteEventFile: (eventId: string, actorId: string, fileId: string) =>
    call<CommandResult<boolean>>("delete_event_file", { eventId, actorId, fileId }),
  renameEventFile: (eventId: string, actorId: string, fileId: string, newName: string) =>
    call<CommandResult<boolean>>("rename_event_file", { eventId, actorId, fileId, newName }),
  searchWorkspace: (userId: string, query: string) =>
    call<CommandResult<WorkspaceSearchResult[]>>("search_workspace", { userId, query }),

  listTemplates: (userId: string) =>
    call<CommandResult<Template[]>>("list_templates", { userId }),
  createTemplate: (userId: string, input: Omit<Template, "id" | "ownerId" | "isCustom" | "gradient" | "badge">) =>
    call<CommandResult<Template>>("create_template", { userId, input }),

  listUsers: (userId: string) => call<CommandResult<UserRecord[]>>("manage_workspace_users", { userId, action: "list", targetUserId: null, name: null, email: null, password: null, role: null }),
  manageWorkspaceUser: (userId: string, action: string, input: { targetUserId?: string; name?: string; email?: string; password?: string; role?: string } = {}) =>
    call<CommandResult<any>>("manage_workspace_users", { userId, action, targetUserId: input.targetUserId ?? null, name: input.name ?? null, email: input.email ?? null, password: input.password ?? null, role: input.role ?? null }),
  getPreferences: (userId: string) =>
    call<CommandResult<PreferenceRecord>>("get_preferences", { userId }),
  updatePreferences: (userId: string, input: {
    eventReminders?: boolean;
    emailUpdates?: boolean;
    weeklyDigest?: boolean;
    defaultCapacity?: number | null;
  }) =>
    call<CommandResult<PreferenceRecord>>("update_preferences", {
      userId,
      input,
    }),

  requestPasswordReset: (email: string) =>
    call<CommandResult<{ success?: string; error?: string; devLink?: string }>>(
      "request_password_reset",
      { email },
    ),
  syncGetConfig: () => call<CommandResult<SyncConfigInfo>>("sync_get_config"),
  syncSaveConfig: (websiteUrl: string, token: string, userId: string) =>
    call<CommandResult<SyncConfigInfo>>("sync_save_config", {
      websiteUrl,
      token,
      userId,
    }),
  syncAutoPair: (email: string, password: string, userId: string) =>
    call<CommandResult<SyncConfigInfo>>("sync_auto_pair", {
      email,
      password,
      userId,
    }),
  syncDisconnect: () => call<CommandResult<boolean>>("sync_disconnect"),
  syncNow: () => call<CommandResult<number>>("sync_now"),
  syncManageProfile: (action: string, options: { name?: string; mimeType?: string; dataBase64?: string } = {}) =>
    call<CommandResult<{ profile: { id: string; name: string; email: string; avatarUrl: string | null; googleAvatarUrl: string | null } }>>("sync_manage_profile", { action, name: options.name ?? null, mimeType: options.mimeType ?? null, dataBase64: options.dataBase64 ?? null }),
  syncGetCalendarFeed: (rotate = false) => call<CommandResult<string>>("sync_get_calendar_feed", { rotate }),
};