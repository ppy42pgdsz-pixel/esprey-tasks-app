/**
 * PUT /api/subtasks/:id/assignees — set who a subtask is assigned to (owner only).
 * Body: { user_emails: string[], contact_ids: string[] }
 */
import { meFromCtx, isTaskOwner, logEvent } from '../../_lib';

interface Env { DB: D1Database }

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

export const onRequestPut: PagesFunction<Env> = async (ctx) => {
  const { id } = ctx.params as { id: string };
  const me = await meFromCtx(ctx.env.DB, ctx);

  const sub = await ctx.env.DB.prepare('SELECT task_id, text FROM subtasks WHERE id = ?').bind(id).first<{ task_id: string; text: string }>();
  if (!sub) return json({ error: 'Not found' }, 404);
  if (!(await isTaskOwner(ctx.env.DB, sub.task_id, me))) return json({ error: 'Only the owner can assign subtasks' }, 403);

  const body = await ctx.request.json<{ user_emails?: string[]; contact_ids?: string[] }>();
  const emails = Array.from(new Set((body.user_emails ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean)));
  const contactIds = Array.from(new Set((body.contact_ids ?? []).filter(Boolean)));

  const stmts = [
    ctx.env.DB.prepare('DELETE FROM subtask_assignees WHERE subtask_id = ?').bind(id),
    ctx.env.DB.prepare('DELETE FROM subtask_contacts WHERE subtask_id = ?').bind(id),
  ];
  for (const e of emails) stmts.push(ctx.env.DB.prepare('INSERT OR IGNORE INTO subtask_assignees (subtask_id, user_email) VALUES (?, ?)').bind(id, e));
  for (const c of contactIds) stmts.push(ctx.env.DB.prepare('INSERT OR IGNORE INTO subtask_contacts (subtask_id, contact_id) VALUES (?, ?)').bind(id, c));
  await ctx.env.DB.batch(stmts);

  // Activity timeline: record who the subtask is now assigned to (by name).
  const label = sub.text.slice(0, 120);
  let who = 'no one';
  if (emails.length) {
    const { results: names } = await ctx.env.DB.prepare(
      `SELECT name FROM users WHERE email IN (${emails.map(() => '?').join(',')})`,
    ).bind(...emails).all<{ name: string }>();
    who = names.length ? names.map((n) => n.name).join(', ') : emails.join(', ');
  }
  await logEvent(ctx.env.DB, sub.task_id, me, 'assigned', `Assigned “${label}” to ${who}`);

  return json({ ok: true, user_emails: emails, contact_ids: contactIds });
};
