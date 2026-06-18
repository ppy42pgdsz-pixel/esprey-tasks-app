/**
 * GET    /api/tasks/:id   — get single task
 * PATCH  /api/tasks/:id   — update task fields
 * DELETE /api/tasks/:id   — delete task
 */

import { meFromCtx, canAccessTask, isTaskOwner } from '../_lib';

interface Env {
  DB: D1Database;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const { id } = ctx.params as { id: string };
  const me = await meFromCtx(ctx.env.DB, ctx);
  if (!(await canAccessTask(ctx.env.DB, id, me))) return json({ error: 'Not found' }, 404);
  const task = await ctx.env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first();
  if (!task) return json({ error: 'Not found' }, 404);
  return json(task);
};

export const onRequestPatch: PagesFunction<Env> = async (ctx) => {
  const { id } = ctx.params as { id: string };
  const me = await meFromCtx(ctx.env.DB, ctx);
  if (!(await isTaskOwner(ctx.env.DB, id, me))) return json({ error: 'Only the owner can edit this task' }, 403);
  const body = await ctx.request.json<Record<string, unknown>>();

  const allowed = ['title', 'description', 'status', 'priority', 'due_date', 'draft_reply', 'company_id', 'company_name', 'contact_id', 'contact_name'];
  const updates: string[] = [];
  const values: unknown[] = [];

  for (const key of allowed) {
    if (key in body) {
      updates.push(`${key} = ?`);
      values.push(body[key]);
    }
  }

  if (updates.length === 0) {
    return json({ error: 'No valid fields to update' }, 400);
  }

  updates.push('updated_at = ?');
  values.push(Date.now());
  values.push(id);

  await ctx.env.DB.prepare(
    `UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`
  )
    .bind(...values)
    .run();

  const task = await ctx.env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first();
  if (!task) return json({ error: 'Not found' }, 404);
  return json(task);
};

export const onRequestDelete: PagesFunction<Env> = async (ctx) => {
  const { id } = ctx.params as { id: string };
  const me = await meFromCtx(ctx.env.DB, ctx);
  if (!(await isTaskOwner(ctx.env.DB, id, me))) return json({ error: 'Only the owner can delete this task' }, 403);
  // Owner delete: remove the task and its dependents.
  await ctx.env.DB.batch([
    ctx.env.DB.prepare('DELETE FROM subtasks WHERE task_id = ?').bind(id),
    ctx.env.DB.prepare('DELETE FROM task_shares WHERE task_id = ?').bind(id),
    ctx.env.DB.prepare('DELETE FROM task_attachments WHERE task_id = ?').bind(id),
    ctx.env.DB.prepare('DELETE FROM tasks WHERE id = ?').bind(id),
  ]);
  return json({ ok: true });
};
