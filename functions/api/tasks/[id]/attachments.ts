/**
 * GET /api/tasks/:id/attachments — list attachments for a task (metadata only).
 */

import { meFromCtx, canAccessTask } from '../../_lib';

interface Env { DB: D1Database }

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const { id } = ctx.params as { id: string };
  const me = await meFromCtx(ctx.env.DB, ctx);
  if (!(await canAccessTask(ctx.env.DB, id, me))) return json({ error: 'Forbidden' }, 403);
  const { results } = await ctx.env.DB.prepare(
    `SELECT id, task_id, filename, mime_type, size, created_at
     FROM task_attachments WHERE task_id = ? ORDER BY created_at ASC`,
  ).bind(id).all();
  return json(results);
};
