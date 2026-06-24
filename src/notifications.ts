/**
 * Client-side notifications: permission, service-worker registration, and
 * showing OS banners. Uses the service worker's showNotification (required on
 * Android; works everywhere) rather than the bare Notification constructor.
 */
import type { AppNotification } from './types';

export function notifSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator;
}

export function notifPermission(): NotificationPermission {
  return notifSupported() ? Notification.permission : 'denied';
}

let regPromise: Promise<ServiceWorkerRegistration | null> | null = null;
export function ensureServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!notifSupported()) return Promise.resolve(null);
  if (!regPromise) {
    regPromise = navigator.serviceWorker
      .register('/sw.js')
      .then(() => navigator.serviceWorker.ready)
      .catch(() => null);
  }
  return regPromise;
}

/** Ask the OS for permission. Registers the SW if granted. */
export async function requestNotifPermission(): Promise<NotificationPermission> {
  if (!notifSupported()) return 'denied';
  const result = await Notification.requestPermission();
  if (result === 'granted') await ensureServiceWorker();
  return result;
}

/** Show OS banners for the given notifications (no-op without permission). */
export async function showNotifications(items: AppNotification[]): Promise<void> {
  if (!notifSupported() || Notification.permission !== 'granted' || items.length === 0) return;
  const reg = await ensureServiceWorker();
  if (!reg) return;
  for (const n of items) {
    try {
      await reg.showNotification(n.title, {
        body: n.body,
        tag: n.id,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        data: { url: n.task_id ? `/?task=${encodeURIComponent(n.task_id)}` : '/' },
      });
    } catch { /* ignore individual failures */ }
  }
}
