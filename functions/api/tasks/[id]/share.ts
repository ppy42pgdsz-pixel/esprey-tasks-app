/**
 * GET /api/tasks/:id/share  — current visibility + who it's shared with (owner or shared user)
 * PUT /api/tasks/:id/share  — set visibility + shared emails (owner only)
 */
import { json, rawEmail, resolvePrimary } from '../../_lib';

interface Env { DB: D1Database }

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const { id } = ctx.params as { id: string };
  const me = await resolvePrimary(ctx.env.DB, rawEmail(ctx));
  const task = await ctx.env.DB.prepare('SELECT owner_email, visibility FROM tasks WHERE id = ?')
    .bind(id).first<{ owner_email: string | null; visibility: string }>();
  if (!task) return json({ error: 'Not found' }, 404);

  const { results } = await ctx.env.DB.prepare('SELECT user_email FROM task_shares WHERE task_id = ?').bind(id).all<{ user_email: string }>();
  const user_emails = results.map((r) => r.user_email);

  const isOwner = (task.owner_email ?? '').toLowerCase() === me;
  if (!isOwner && !user_emails.includes(me)) return json({ error: 'Forbidden' }, 403);

  return json({ owner_email: task.owner_email, visibility: task.visibility, user_emails });
};

export const onRequestPut: PagesFunction<Env> = async (ctx) => {
  const { id } = ctx.params as { id: string };
  const me = await resolvePrimary(ctx.env.DB, rawEmail(ctx));
  const task = await ctx.env.DB.prepare('SELECT owner_email FROM tasks WHERE id = ?').bind(id).first<{ owner_email: string | null }>();
  if (!task) return json({ error: 'Not found' }, 404);
  if ((task.owner_email ?? '').toLowerCase() !== me) return json({ error: 'Only the owner can change sharing' }, 403);

  const body = await ctx.request.json<{ visibility?: string; user_emails?: string[] }>();
  const visibility = body.visibility === 'shared' ? 'shared' : 'private';
  const emails = visibility === 'shared'
    ? Array.from(new Set((body.user_emails ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean).filter((e) => e !== me)))
    : [];

  const stmts = [
    ctx.env.DB.prepare('UPDATE tasks SET visibility = ?, updated_at = ? WHERE id = ?').bind(visibility, Date.now(), id),
    ctx.env.DB.prepare('DELETE FROM task_shares WHERE task_id = ?').bind(id),
  ];
  for (const e of emails) {
    stmts.push(ctx.env.DB.prepare('INSERT OR IGNORE INTO task_shares (task_id, user_email) VALUES (?, ?)').bind(id, e));
  }
  await ctx.env.DB.batch(stmts);

  return json({ ok: true, visibility, user_emails: emails });
};
