/**
 * GET /api/attachments/:id — stream an attachment's bytes from R2.
 * Gated by Cloudflare Access (via _middleware). Served inline so images/PDFs
 * render in the browser.
 */

interface Env {
  DB: D1Database;
  ATTACHMENTS: R2Bucket;
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const { id } = ctx.params as { id: string };

  const row = await ctx.env.DB.prepare(
    'SELECT r2_key, filename, mime_type FROM task_attachments WHERE id = ?',
  )
    .bind(id)
    .first<{ r2_key: string; filename: string | null; mime_type: string | null }>();

  if (!row) return new Response('Not found', { status: 404 });

  const obj = await ctx.env.ATTACHMENTS.get(row.r2_key);
  if (!obj) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  headers.set('Content-Type', row.mime_type || 'application/octet-stream');
  const safeName = (row.filename || 'attachment').replace(/"/g, '');
  headers.set('Content-Disposition', `inline; filename="${safeName}"`);
  headers.set('Cache-Control', 'private, max-age=3600');
  return new Response(obj.body, { headers });
};
