/**
 * GET /api/attachments/:id — stream an attachment's bytes from R2.
 * Gated by Cloudflare Access (via _middleware). Served inline so images/PDFs
 * render in the browser.
 */

import { meFromCtx, canAccessTask, canUpdateSubtask, isTaskOwner } from '../_lib';

interface Env {
  DB: D1Database;
  ATTACHMENTS: R2Bucket;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const { id } = ctx.params as { id: string };

  const row = await ctx.env.DB.prepare(
    'SELECT task_id, r2_key, filename, mime_type FROM task_attachments WHERE id = ?',
  )
    .bind(id)
    .first<{ task_id: string; r2_key: string; filename: string | null; mime_type: string | null }>();

  if (!row) return new Response('Not found', { status: 404 });

  const me = await meFromCtx(ctx.env.DB, ctx);
  if (!(await canAccessTask(ctx.env.DB, row.task_id, me))) return new Response('Forbidden', { status: 403 });

  const obj = await ctx.env.ATTACHMENTS.get(row.r2_key);
  if (!obj) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  headers.set('Content-Type', row.mime_type || 'application/octet-stream');
  const safeName = (row.filename || 'attachment').replace(/"/g, '');
  headers.set('Content-Disposition', `inline; filename="${safeName}"`);
  headers.set('Cache-Control', 'private, max-age=3600');
  return new Response(obj.body, { headers });
};

export const onRequestDelete: PagesFunction<Env> = async (ctx) => {
  const { id } = ctx.params as { id: string };
  const row = await ctx.env.DB.prepare(
    'SELECT task_id, subtask_id, r2_key FROM task_attachments WHERE id = ?',
  ).bind(id).first<{ task_id: string; subtask_id: string | null; r2_key: string }>();
  if (!row) return json({ error: 'Not found' }, 404);

  const me = await meFromCtx(ctx.env.DB, ctx);
  // A subtask file may be removed by the owner or an assignee; a task-level
  // (email) attachment only by the owner.
  const allowed = row.subtask_id
    ? await canUpdateSubtask(ctx.env.DB, row.subtask_id, me)
    : await isTaskOwner(ctx.env.DB, row.task_id, me);
  if (!allowed) return json({ error: 'Not allowed to delete this attachment' }, 403);

  try { await ctx.env.ATTACHMENTS.delete(row.r2_key); } catch { /* ignore */ }
  await ctx.env.DB.prepare('DELETE FROM task_attachments WHERE id = ?').bind(id).run();
  return json({ ok: true });
};
