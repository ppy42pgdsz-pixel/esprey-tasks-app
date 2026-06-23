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

/** True if `me` owns the task, it's shared with them, OR they're assigned a subtask in it. */
export async function canAccessTask(db: D1Database, taskId: string, me: string): Promise<boolean> {
  const t = await db.prepare('SELECT owner_email FROM tasks WHERE id = ?').bind(taskId).first<{ owner_email: string | null }>();
  if (!t) return false;
  if ((t.owner_email ?? '').toLowerCase() === me) return true;
  const s = await db.prepare('SELECT 1 FROM task_shares WHERE task_id = ? AND user_email = ?').bind(taskId, me).first();
  if (s) return true;
  const a = await db.prepare(
    'SELECT 1 FROM subtask_assignees sa JOIN subtasks st ON st.id = sa.subtask_id WHERE st.task_id = ? AND sa.user_email = ? LIMIT 1',
  ).bind(taskId, me).first();
  return !!a;
}

/** True if `me` is assigned to the given subtask. */
export async function isSubtaskAssignee(db: D1Database, subtaskId: string, me: string): Promise<boolean> {
  const r = await db.prepare('SELECT 1 FROM subtask_assignees WHERE subtask_id = ? AND user_email = ?').bind(subtaskId, me).first();
  return !!r;
}

/** True if `me` owns the parent task OR is assigned to the subtask (may update status/notes). */
export async function canUpdateSubtask(db: D1Database, subtaskId: string, me: string): Promise<boolean> {
  const sub = await db.prepare('SELECT task_id FROM subtasks WHERE id = ?').bind(subtaskId).first<{ task_id: string }>();
  if (!sub) return false;
  if (await isTaskOwner(db, sub.task_id, me)) return true;
  return isSubtaskAssignee(db, subtaskId, me);
}

/** Resolve the canonical signed-in email for an API context. */
export async function meFromCtx(db: D1Database, ctx: { data: Record<string, unknown> }): Promise<string> {
  return resolvePrimary(db, rawEmail(ctx));
}

/**
 * Append an entry to a task's activity timeline. Best-effort: logging must never
 * break the action it's recording, so failures are swallowed.
 */
export async function logEvent(
  db: D1Database,
  taskId: string,
  actorEmail: string | null,
  type: string,
  detail = '',
): Promise<void> {
  try {
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 21);
    await db
      .prepare('INSERT INTO task_events (id, task_id, actor_email, type, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, taskId, actorEmail || null, type, detail.slice(0, 500), Date.now())
      .run();
  } catch (e) {
    console.error('logEvent failed', type, e);
  }
}

/** Is `me` (a canonical email) an admin? */
export async function isAdminEmail(db: D1Database, me: string, adminEmail?: string): Promise<boolean> {
  if (!me) return false;
  if (me === (adminEmail ?? '').toLowerCase()) return true;
  const row = await db.prepare('SELECT role FROM users WHERE email = ?').bind(me).first<{ role: string }>();
  return row?.role === 'admin';
}
