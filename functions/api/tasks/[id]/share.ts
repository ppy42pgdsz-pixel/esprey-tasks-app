/**
 * GET /api/tasks/:id/share  — project visibility: the members_see_all flag and
 *                             the list of watcher emails (owner or watcher).
 * PUT /api/tasks/:id/share  — set members_see_all + watcher emails (owner only).
 *
 * "Watchers" = people who can see the whole project without having a task in it
 * (stored in task_shares). members_see_all = anyone with a task here sees all.
 */
import { json, rawEmail, resolvePrimary } from '../../_lib';

interface Env { DB: D1Database }

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const { id } = ctx.params as { id: string };
  const me = await resolvePrimary(ctx.env.DB, rawEmail(ctx));
  const task = await ctx.env.DB.prepare('SELECT owner_email, members_see_all FROM tasks WHERE id = ?')
    .bind(id).first<{ owner_email: string | null; members_see_all: number }>();
  if (!task) return json({ error: 'Not found' }, 404);

  const { results } = await ctx.env.DB.prepare('SELECT user_email FROM task_shares WHERE task_id = ?').bind(id).all<{ user_email: string }>();
  const user_emails = results.map((r) => r.user_email);

  const isOwner = (task.owner_email ?? '').toLowerCase() === me;
  if (!isOwner && !user_emails.includes(me)) return json({ error: 'Forbidden' }, 403);

  return json({ owner_email: task.owner_email, members_see_all: !!task.members_see_all, user_emails });
};

export const onRequestPut: PagesFunction<Env> = async (ctx) => {
  const { id } = ctx.params as { id: string };
  const me = await resolvePrimary(ctx.env.DB, rawEmail(ctx));
  const task = await ctx.env.DB.prepare('SELECT owner_email FROM tasks WHERE id = ?').bind(id).first<{ owner_email: string | null }>();
  if (!task) return json({ error: 'Not found' }, 404);
  if ((task.owner_email ?? '').toLowerCase() !== me) return json({ error: 'Only the owner can change sharing' }, 403);

  const body = await ctx.request.json<{ members_see_all?: boolean; user_emails?: string[] }>();
  const membersSeeAll = body.members_see_all ? 1 : 0;
  const emails = Array.from(new Set((body.user_emails ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean).filter((e) => e !== me)));

  const stmts = [
    ctx.env.DB.prepare('UPDATE tasks SET members_see_all = ?, updated_at = ? WHERE id = ?').bind(membersSeeAll, Date.now(), id),
    ctx.env.DB.prepare('DELETE FROM task_shares WHERE task_id = ?').bind(id),
  ];
  for (const e of emails) {
    stmts.push(ctx.env.DB.prepare('INSERT OR IGNORE INTO task_shares (task_id, user_email) VALUES (?, ?)').bind(id, e));
  }
  await ctx.env.DB.batch(stmts);

  return json({ ok: true, members_see_all: !!membersSeeAll, user_emails: emails });
};
