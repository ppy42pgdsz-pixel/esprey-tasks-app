/**
 * GET  /api/tasks/:id/subtasks — list a task's subtasks (ordered)
 * POST /api/tasks/:id/subtasks — add a subtask { text }
 */

import { meFromCtx, canAccessTask, isTaskOwner, logEvent } from '../../_lib';

interface Env { DB: D1Database }

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

function nanoid() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 21);
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const { id } = ctx.params as { id: string };
  const me = await meFromCtx(ctx.env.DB, ctx);
  if (!(await canAccessTask(ctx.env.DB, id, me))) return json({ error: 'Forbidden' }, 403);
  // Owners see every subtask; a member assigned into the task sees only theirs.
  const owner = await isTaskOwner(ctx.env.DB, id, me);
  const subsStmt = owner
    ? ctx.env.DB.prepare('SELECT * FROM subtasks WHERE task_id = ? ORDER BY position ASC, created_at ASC').bind(id)
    : ctx.env.DB.prepare(
        'SELECT * FROM subtasks WHERE task_id = ? AND id IN (SELECT subtask_id FROM subtask_assignees WHERE user_email = ?) ORDER BY position ASC, created_at ASC',
      ).bind(id, me);
  const { results: subs } = await subsStmt.all<{ id: string }>();
  const { results: asg } = await ctx.env.DB.prepare(
    'SELECT subtask_id, user_email FROM subtask_assignees WHERE subtask_id IN (SELECT id FROM subtasks WHERE task_id = ?)',
  ).bind(id).all<{ subtask_id: string; user_email: string }>();
  const { results: cons } = await ctx.env.DB.prepare(
    'SELECT subtask_id, contact_id FROM subtask_contacts WHERE subtask_id IN (SELECT id FROM subtasks WHERE task_id = ?)',
  ).bind(id).all<{ subtask_id: string; contact_id: string }>();
  const out = subs.map((s) => ({
    ...s,
    assignee_emails: asg.filter((a) => a.subtask_id === s.id).map((a) => a.user_email),
    contact_ids: cons.filter((c) => c.subtask_id === s.id).map((c) => c.contact_id),
  }));
  return json(out);
};

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const { id } = ctx.params as { id: string };
  const me = await meFromCtx(ctx.env.DB, ctx);
  if (!(await isTaskOwner(ctx.env.DB, id, me))) return json({ error: 'Only the owner can edit this task' }, 403);
  const body = await ctx.request.json<{ text: string }>();
  const text = body.text?.trim();
  if (!text) return json({ error: 'text is required' }, 400);

  const now = Date.now();
  const sid = nanoid();
  const row = await ctx.env.DB.prepare(
    'SELECT COALESCE(MAX(position), -1) + 1 AS next FROM subtasks WHERE task_id = ?',
  ).bind(id).first<{ next: number }>();
  const position = row?.next ?? 0;

  await ctx.env.DB.prepare(
    'INSERT INTO subtasks (id, task_id, text, done, position, created_at) VALUES (?, ?, ?, 0, ?, ?)',
  ).bind(sid, id, text.slice(0, 300), position, now).run();

  await logEvent(ctx.env.DB, id, me, 'subtask_added', `Added subtask: ${text.slice(0, 120)}`);

  const created = await ctx.env.DB.prepare('SELECT * FROM subtasks WHERE id = ?').bind(sid).first();
  return json(created, 201);
};
