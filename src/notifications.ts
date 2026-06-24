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

function vapidKeyToBytes(base64url: string): Uint8Array {
  const b64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function pushSupported(): boolean {
  return notifSupported() && 'PushManager' in window;
}

/** Subscribe this browser to Web Push and register it server-side. Returns true on success. */
export async function subscribeToPush(): Promise<boolean> {
  if (!pushSupported() || Notification.permission !== 'granted') return false;
  const reg = await ensureServiceWorker();
  if (!reg) return false;
  try {
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const { key } = await fetch('/api/push/key').then((r) => r.json() as Promise<{ key: string }>);
      if (!key) return false;
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKeyToBytes(key) as BufferSource });
    }
    const json = sub.toJSON();
    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: { endpoint: sub.endpoint, keys: json.keys } }),
    });
    return true;
  } catch {
    return false;
  }
}

/** True if this browser already has a live push subscription. */
export async function hasPushSubscription(): Promise<boolean> {
  if (!pushSupported()) return false;
  const reg = await ensureServiceWorker();
  if (!reg) return false;
  try { return !!(await reg.pushManager.getSubscription()); } catch { return false; }
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
