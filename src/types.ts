export type SessionUser = {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string | null;
  workspaceRole: string;
};

export type EventRecord = {
  id: string;
  ownerId: string;
  title: string;
  description: string;
  category: string;
  venue: string;
  startsAt: string;
  capacity: number | null;
  visibility: string;
  createdAt: string;
};

export type EventListItem = {
  id: string;
  title: string;
  month: string;
  day: string;
  time: string;
  venue: string;
  capacity: number | null;
  status: "Upcoming" | "Past";
  isOwner: boolean;
};

export type EventMember = {
  id: string;
  eventId: string;
  userId: string;
  role: string;
  invitedBy: string;
  invitedAt: string;
  status: string;
};

export type SyncedInvitation = {
  id: string;
  eventId: string;
  email: string;
  role: string;
  status: "pending" | "accepted" | "declined";
  createdAt: string;
  expiresAt: string;
  eventTitle: string;
  startsAt: string;
  venue: string;
  category: string;
  inviterName: string | null;
};

export type AvailableEventUser = {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
};

export type SyncedEventMember = {
  id: string;
  eventId: string;
  userId: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  role: string;
  invitedAt: string;
  status: string;
};

export type TaskAssignee = {
  id: string;
  name: string;
  email: string;
};

export type EventTeamInvitation = {
  id: string;
  email: string;
  role: string;
  status: string;
  createdAt: string;
  expiresAt: string;
};

export type EventTask = {
  id: string;
  eventId: string;
  title: string;
  notes: string;
  status: "open" | "done";
  assigneeId: string | null;
  assigneeName: string | null;
  dueAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AgendaItem = {
  id: string;
  eventId: string;
  title: string;
  description: string;
  startsAt: string;
  durationMinutes: number;
  location: string;
  speakerName: string;
  status: "scheduled" | "live" | "completed" | "cancelled";
  createdAt: string;
  updatedAt: string;
};

export type EventFileRecord = {
  id: string;
  eventId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  uploaderName: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceSearchResult = {
  id: string;
  kind: string;
  title: string;
  detail: string;
  eventId: string;
};

export type ActivityEntry = {
  id: string;
  kind: string;
  summary: string;
  createdAt: string;
  actorName: string | null;
  actorAvatarUrl: string | null;
};

export type Notification = {
  id: string;
  eventId: string | null;
  kind: string;
  title: string;
  message: string;
  linkUrl: string;
  readAt: string | null;
  createdAt: string;
};

export type Template = {
  id: string;
  name: string;
  category: string;
  description: string;
  defaultVenue: string;
  defaultCapacity: number | null;
  defaultDurationMinutes: number;
  gradient: string;
  badge: string;
  agendaPresets: any[];
  taskPresets: any[];
  ownerId: string | null;
  isCustom: boolean;
};

export type UserRecord = {
  id: string;
  name: string;
  email: string;
  provider: string;
  avatarUrl: string | null;
  workspaceRole: string;
  createdAt: string;
};

export type PreferenceRecord = {
  userId: string;
  eventReminders: boolean;
  emailUpdates: boolean;
  weeklyDigest: boolean;
  defaultCapacity: number | null;
  updatedAt: string;
};

export type CommandResult<T> = {
  success: boolean;
  data: T | null;
  error: string | null;
};
export type InvitationSendResult = {
  inviteUrl: string;
  message: string;
};

export type SyncConfigInfo = {
  connected: boolean;
  websiteUrl: string;
  pairedAccountEmail: string;
  lastSyncAt: string | null;
  lastError: string | null;
};
