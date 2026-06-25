/**
 * GET    /api/tasks/:id   — get single task
 * PATCH  /api/tasks/:id   — update task fields
 * DELETE /api/tasks/:id   — delete task
 */

import { meFromCtx, canAccessTask, isTaskOwner, logEvent } from '../_lib';
import { releaseLibraryRef } from '../_attachments';

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

  // Capture the prior status so we can log complete/reopen transitions.
  const prior = 'status' in body
    ? await ctx.env.DB.prepare('SELECT status FROM tasks WHERE id = ?').bind(id).first<{ status: string }>()
    : null;

  const allowed = ['title', 'description', 'status', 'priority', 'due_date', 'draft_reply', 'company_id', 'company_name', 'contact_id', 'contact_name', 'recur_interval', 'recur_unit', 'recur_next_at', 'recur_active'];
  const updates: string[] = [];
  const values: unknown[] = [];

  for (const key of allowed) {
    if (key in body) {
      updates.push(`${key} = ?`);
      values.push(body[key]);
    }
  }

  // Completion timestamp: set when the task is marked done, cleared when reopened.
  if ('status' in body) {
    updates.push('completed_at = ?');
    values.push(body.status === 'done' ? Date.now() : null);
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

  // Log a completed/reopened transition (only when the status actually changed).
  if (prior && 'status' in body && body.status !== prior.status) {
    if (body.status === 'done') await logEvent(ctx.env.DB, id, me, 'completed', 'Marked the project complete');
    else if (prior.status === 'done') await logEvent(ctx.env.DB, id, me, 'reopened', 'Reopened the project');
  }

  const task = await ctx.env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first();
  if (!task) return json({ error: 'Not found' }, 404);
  return json(task);
};

export const onRequestDelete: PagesFunction<Env> = async (ctx) => {
  const { id } = ctx.params as { id: string };
  const me = await meFromCtx(ctx.env.DB, ctx);
  if (!(await isTaskOwner(ctx.env.DB, id, me))) return json({ error: 'Only the owner can delete this task' }, 403);
  // Library files referenced by this project — release them after the delete.
  const { results: libRefs } = await ctx.env.DB.prepare('SELECT DISTINCT library_file_id FROM task_attachments WHERE task_id = ? AND library_file_id IS NOT NULL').bind(id).all<{ library_file_id: string }>();
  // Owner delete: remove the task and its dependents.
  await ctx.env.DB.batch([
    ctx.env.DB.prepare('DELETE FROM subtask_comments WHERE subtask_id IN (SELECT id FROM subtasks WHERE task_id = ?)').bind(id),
    ctx.env.DB.prepare('DELETE FROM subtasks WHERE task_id = ?').bind(id),
    ctx.env.DB.prepare('DELETE FROM task_shares WHERE task_id = ?').bind(id),
    ctx.env.DB.prepare('DELETE FROM task_attachments WHERE task_id = ?').bind(id),
    ctx.env.DB.prepare('DELETE FROM task_events WHERE task_id = ?').bind(id),
    ctx.env.DB.prepare('DELETE FROM notifications WHERE task_id = ?').bind(id),
    ctx.env.DB.prepare('DELETE FROM tasks WHERE id = ?').bind(id),
  ]);
  for (const r of libRefs) await releaseLibraryRef(ctx.env.DB, r.library_file_id);
  return json({ ok: true });
};
