/**
 * GET  /api/subtasks/:id/comments — the task's comment thread (oldest first),
 *                                    each attributed to its author.
 * POST /api/subtasks/:id/comments — add a comment { body }.
 * Anyone who can see the task (owner, watcher, member in a see-all project, or
 * the assignee) can read and add comments.
 */

import { meFromCtx, canViewSubtask } from '../../_lib';

interface Env { DB: D1Database }

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
function nanoid() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 21);
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const { id } = ctx.params as { id: string };
  const me = await meFromCtx(ctx.env.DB, ctx);
  if (!(await canViewSubtask(ctx.env.DB, id, me))) return json({ error: 'Forbidden' }, 403);

  const { results } = await ctx.env.DB.prepare(
    `SELECT c.id, c.subtask_id, c.author_email, c.body, c.created_at, u.name AS author_name
     FROM subtask_comments c
     LEFT JOIN users u ON u.email = c.author_email
     WHERE c.subtask_id = ?
     ORDER BY c.created_at ASC`,
  ).bind(id).all();
  return json(results);
};

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const { id } = ctx.params as { id: string };
  const me = await meFromCtx(ctx.env.DB, ctx);
  if (!(await canViewSubtask(ctx.env.DB, id, me))) return json({ error: 'Not allowed to comment here' }, 403);

  const body = await ctx.request.json<{ body?: string }>();
  const text = (body.body ?? '').trim();
  if (!text) return json({ error: 'comment is empty' }, 400);

  const cid = nanoid();
  const now = Date.now();
  await ctx.env.DB.prepare(
    'INSERT INTO subtask_comments (id, subtask_id, author_email, body, created_at) VALUES (?, ?, ?, ?, ?)',
  ).bind(cid, id, me, text.slice(0, 4000), now).run();

  const created = await ctx.env.DB.prepare(
    `SELECT c.id, c.subtask_id, c.author_email, c.body, c.created_at, u.name AS author_name
     FROM subtask_comments c LEFT JOIN users u ON u.email = c.author_email WHERE c.id = ?`,
  ).bind(cid).first();
  return json(created, 201);
};
