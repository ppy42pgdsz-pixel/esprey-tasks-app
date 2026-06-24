/**
 * GET  /api/notifications        — my unread notifications (newest first).
 * POST /api/notifications  { ids } — mark those notifications read.
 */

import { meFromCtx, json } from './_lib';

interface Env { DB: D1Database }

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const me = await meFromCtx(ctx.env.DB, ctx);
  const { results } = await ctx.env.DB.prepare(
    `SELECT id, type, title, body, task_id, subtask_id, created_at
     FROM notifications WHERE user_email = ? AND read_at IS NULL
     ORDER BY created_at DESC LIMIT 50`,
  ).bind(me).all();
  return json(results);
};

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const me = await meFromCtx(ctx.env.DB, ctx);
  const body = await ctx.request.json<{ ids?: string[] }>().catch(() => ({} as { ids?: string[] }));
  const ids = (body.ids ?? []).filter(Boolean);
  if (ids.length === 0) return json({ ok: true, marked: 0 });

  const now = Date.now();
  const placeholders = ids.map(() => '?').join(',');
  await ctx.env.DB.prepare(
    `UPDATE notifications SET read_at = ? WHERE user_email = ? AND id IN (${placeholders})`,
  ).bind(now, me, ...ids).run();
  return json({ ok: true, marked: ids.length });
};
