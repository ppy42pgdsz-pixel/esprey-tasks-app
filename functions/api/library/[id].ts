/**
 * DELETE /api/library/:id — remove a file from my library. Also detaches it from
 * any tasks it was attached to, and deletes the stored object.
 */
import { meFromCtx, json } from '../_lib';

interface Env { DB: D1Database; ATTACHMENTS: R2Bucket }

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
