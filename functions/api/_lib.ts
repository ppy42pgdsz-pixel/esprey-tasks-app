/**
 * Shared helpers for API functions. (Files starting with _ aren't routes.)
 */

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

/** The signed-in email from the Access JWT (set by _middleware). */
export function rawEmail(ctx: { data: Record<string, unknown> }): string {
  return ((ctx.data as { userEmail?: string }).userEmail ?? '').toLowerCase();
}

/**
 * Resolve any address (login email or email sender) to its primary user email.
 * Falls back to the address itself if it isn't a known user or alias.
 */
export async function resolvePrimary(db: D1Database, email: string): Promise<string> {
  const e = (email ?? '').toLowerCase();
  if (!e) return e;
  const u = await db.prepare('SELECT email FROM users WHERE email = ?').bind(e).first<{ email: string }>();
  if (u) return u.email.toLowerCase();
  const a = await db.prepare('SELECT user_email FROM user_aliases WHERE alias_email = ?').bind(e).first<{ user_email: string }>();
  if (a) return a.user_email.toLowerCase();
  return e;
}

/** True if `me` (a canonical email) owns the task. */
export async function isTaskOwner(db: D1Database, taskId: string, me: string): Promise<boolean> {
  const t = await db.prepare('SELECT owner_email FROM tasks WHERE id = ?').bind(taskId).first<{ owner_email: string | null }>();
  return !!t && (t.owner_email ?? '').toLowerCase() === me;
}

/** True if `me` owns the task OR it's shared with them. */
export async function canAccessTask(db: D1Database, taskId: string, me: string): Promise<boolean> {
  const t = await db.prepare('SELECT owner_email FROM tasks WHERE id = ?').bind(taskId).first<{ owner_email: string | null }>();
  if (!t) return false;
  if ((t.owner_email ?? '').toLowerCase() === me) return true;
  const s = await db.prepare('SELECT 1 FROM task_shares WHERE task_id = ? AND user_email = ?').bind(taskId, me).first();
  return !!s;
}

/** Resolve the canonical signed-in email for an API context. */
export async function meFromCtx(db: D1Database, ctx: { data: Record<string, unknown> }): Promise<string> {
  return resolvePrimary(db, rawEmail(ctx));
}

/** Is `me` (a canonical email) an admin? */
export async function isAdminEmail(db: D1Database, me: string, adminEmail?: string): Promise<boolean> {
  if (!me) return false;
  if (me === (adminEmail ?? '').toLowerCase()) return true;
  const row = await db.prepare('SELECT role FROM users WHERE email = ?').bind(me).first<{ role: string }>();
  return row?.role === 'admin';
}
