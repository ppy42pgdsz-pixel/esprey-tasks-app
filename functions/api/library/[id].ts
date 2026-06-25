/**
 * DELETE /api/library/:id — remove a file from my library. Also detaches it from
 * any tasks it was attached to, and deletes the stored object.
 */
import { meFromCtx, json } from '../_lib';

interface Env { DB: D1Database; ATTACHMENTS: R2Bucket }

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const { id } = ctx.params as { id: string };
  const me = await meFromCtx(ctx.env.DB, ctx);
  const row = await ctx.env.DB.prepare('SELECT r2_key, filename, mime_type FROM library_files WHERE id = ? AND user_email = ?')
    .bind(id, me).first<{ r2_key: string; filename: string | null; mime_type: string | null }>();
  if (!row) return new Response('Not found', { status: 404 });
  const obj = await ctx.env.ATTACHMENTS.get(row.r2_key);
  if (!obj) return new Response('Not found', { status: 404 });
  const safeName = (row.filename || 'file').replace(/"/g, '');
  const disposition = new URL(ctx.request.url).searchParams.get('download') ? 'attachment' : 'inline';
  return new Response(obj.body, {
    headers: {
      'Content-Type': row.mime_type || 'application/octet-stream',
      'Content-Disposition': `${disposition}; filename="${safeName}"`,
      'Cache-Control': 'private, max-age=3600',
    },
  });
};

export const onRequestDelete: PagesFunction<Env> = async (ctx) => {
  const { id } = ctx.params as { id: string };
  const me = await meFromCtx(ctx.env.DB, ctx);
  const row = await ctx.env.DB.prepare('SELECT r2_key FROM library_files WHERE id = ? AND user_email = ?').bind(id, me).first<{ r2_key: string }>();
  if (!row) return json({ error: 'Not found' }, 404);

  try { await ctx.env.ATTACHMENTS.delete(row.r2_key); } catch { /* ignore */ }
  await ctx.env.DB.batch([
    ctx.env.DB.prepare('DELETE FROM task_attachments WHERE library_file_id = ?').bind(id),
    ctx.env.DB.prepare('DELETE FROM library_files WHERE id = ?').bind(id),
  ]);
  return json({ ok: true });
};
