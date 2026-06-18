/**
 * GET  /api/tasks/:id/subtasks — list a task's subtasks (ordered)
 * POST /api/tasks/:id/subtasks — add a subtask { text }
 */

import { meFromCtx, canAccessTask, isTaskOwner } from '../../_lib';

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
  const { results } = await ctx.env.DB.prepare(
    'SELECT * FROM subtasks WHERE task_id = ? ORDER BY position ASC, created_at ASC',
  ).bind(id).all();
  return json(results);
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

  const created = await ctx.env.DB.prepare('SELECT * FROM subtasks WHERE id = ?').bind(sid).first();
  return json(created, 201);
};
