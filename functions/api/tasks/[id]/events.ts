/**
 * GET /api/tasks/:id/events — the task's activity timeline (newest first).
 * Anyone who can access the task can read its history.
 */

import { meFromCtx, isTaskOwner } from '../../_lib';

interface Env { DB: D1Database }

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const { id } = ctx.params as { id: string };
  const me = await meFromCtx(ctx.env.DB, ctx);
  // Owner-only: the timeline can reference subtasks a member isn't assigned to,
  // so it stays consistent with the per-member subtask scoping elsewhere.
  if (!(await isTaskOwner(ctx.env.DB, id, me))) return json({ error: 'Forbidden' }, 403);

  const { results } = await ctx.env.DB.prepare(
    `SELECT e.id, e.task_id, e.actor_email, e.type, e.detail, e.created_at, u.name AS actor_name
     FROM task_events e
     LEFT JOIN users u ON u.email = e.actor_email
     WHERE e.task_id = ?
     ORDER BY e.created_at DESC`,
  ).bind(id).all();
  return json(results);
};
