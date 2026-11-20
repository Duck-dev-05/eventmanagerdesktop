"use client";

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../App";
import { api } from "../lib/api";
import type { Notification } from "../types";
import {
  Badge,
  Button,
  EmptyState,
  PageHeader,
  Section,
  Skeleton,
  cn,
} from "../components/ui";
import { BellIcon } from "../components/icons";

export function NotificationsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    loadNotifications(user.id);
  }, [user]);

  async function loadNotifications(userId: string) {
    const [listResult, countResult] = await Promise.all([
      api.listNotifications(userId),
      api.getUnreadNotificationCount(userId),
    ]);
    if (listResult.success && listResult.data) {
      setNotifications(listResult.data);
    }
    if (countResult.success) setUnreadCount(countResult.data ?? 0);
    setLoading(false);
  }

  async function markAsRead(id: string) {
    if (!user) return;
    const result = await api.markNotificationRead(user.id, id);
    if (!result.success) return;
    setNotifications((previous) => previous.map((notification) =>
      notification.id === id ? { ...notification, readAt: new Date().toISOString() } : notification,
    ));
    setUnreadCount((count) => Math.max(0, count - 1));
  }

  async function markAllRead() {
    if (!user) return;
    const result = await api.markAllNotificationsRead(user.id);
    if (!result.success) return;
    const now = new Date().toISOString();
    setNotifications((previous) => previous.map((notification) => ({ ...notification, readAt: notification.readAt ?? now })));
    setUnreadCount(0);
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="space-y-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-44" />
        </div>
        <Skeleton className="h-[320px] rounded-2xl" />
      </div>
    );
  }

  if (!user) {
    return <p className="text-[12.5px] text-muted">No notifications available.</p>;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Organize"
        title="Notifications"
        description="Invites, reminders and changes across your events."
        actions={
          unreadCount > 0 ? <><Badge tone="accent">{unreadCount} unread</Badge><Button size="sm" variant="secondary" onClick={() => void markAllRead()}>Mark all read</Button></> : <Badge tone="success">All caught up</Badge>
        }
      />

      <Section bodyClassName="p-0">
        {notifications.length === 0 ? (
          <EmptyState
            title="No notifications"
            description="You're all caught up. Notifications will appear here when you're invited to events or activity occurs."
            icon={<BellIcon className="h-5 w-5" />}
          />
        ) : (
          <ul className="divide-y divide-line-soft">
            {notifications.map((notification) => (
              <li key={notification.id}>
                <button
                  type="button"
                  onClick={() => {
                    if (!notification.readAt) void markAsRead(notification.id);
                    if (notification.linkUrl) navigate(notification.linkUrl);
                  }}
                  className="flex w-full gap-3.5 px-5 py-4 text-left transition-colors hover:bg-raised"
                >
                  <span
                    className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                      notification.readAt
                        ? "border border-line-soft bg-sunken text-faint"
                        : "bg-accent-soft text-accent",
                    )}
                  >
                    <BellIcon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-semibold text-ink">
                        {notification.title}
                      </span>
                      {!notification.readAt && (
                        <span
                          aria-label="Unread"
                          className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                        />
                      )}
                    </span>
                    <span className="mt-0.5 block text-[12px] leading-relaxed text-muted">
                      {notification.message}
                    </span>
                    <span className="mt-1 block font-mono text-[10px] uppercase tracking-eyebrow text-faint">
                      {new Date(notification.createdAt).toLocaleDateString(
                        undefined,
                        { month: "short", day: "numeric", year: "numeric" },
                      )}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
