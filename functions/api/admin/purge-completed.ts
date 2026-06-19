/**
 * GET /api/admin/purge-completed?confirm=yes[&days=30] — admin-only manual run
 * of the completed-task cleanup (same logic as the worker's daily cron).
 *
 * For testing: pass days=0 to purge ALL completed tasks immediately. The real
 * cron always uses the 30-day retention.
 */
import { meFromCtx, isAdminEmail, json } from '../_lib';

interface Env {
  DB: D1Database;
  ATTACHMENTS: R2Bucket;
  ADMIN_EMAIL: string;
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const me = await meFromCtx(ctx.env.DB, ctx);
  if (!(await isAdminEmail(ctx.env.DB, me, ctx.env.ADMIN_EMAIL))) {
    return json({ error: 'Admin only' }, 403);
  }

  const url = new URL(ctx.request.url);
  if (url.searchParams.get('confirm') !== 'yes') {
    return json({ error: 'Add ?confirm=yes to run. Optional &days=N (default 30; 0 = all completed).' }, 400);
  }
  const days = Number(url.searchParams.get('days') ?? '30');
  const cutoff = Date.now() - (Number.isFinite(days) ? days : 30) * 24 * 60 * 60 * 1000;

  const { results: doomed } = await ctx.env.DB
    .prepare('SELECT id FROM tasks WHERE completed_at IS NOT NULL AND completed_at < ?')
    .bind(cutoff)
    .all<{ id: string }>();

  for (const { id } of doomed) {
    const { results: atts } = await ctx.env.DB
      .prepare('SELECT r2_key FROM task_attachments WHERE task_id = ?')
      .bind(id)
      .all<{ r2_key: string }>();
    for (const a of atts) {
      try { await ctx.env.ATTACHMENTS.delete(a.r2_key); } catch { /* ignore */ }
    }
    await ctx.env.DB.batch([
      ctx.env.DB.prepare('DELETE FROM subtask_assignees WHERE subtask_id IN (SELECT id FROM subtasks WHERE task_id = ?)').bind(id),
      ctx.env.DB.prepare('DELETE FROM subtask_contacts WHERE subtask_id IN (SELECT id FROM subtasks WHERE task_id = ?)').bind(id),
      ctx.env.DB.prepare('DELETE FROM subtasks WHERE task_id = ?').bind(id),
      ctx.env.DB.prepare('DELETE FROM task_shares WHERE task_id = ?').bind(id),
      ctx.env.DB.prepare('DELETE FROM task_attachments WHERE task_id = ?').bind(id),
      ctx.env.DB.prepare('DELETE FROM tasks WHERE id = ?').bind(id),
    ]);
  }

  return json({ deleted: doomed.length, ids: doomed.map((d) => d.id), days, cutoff });
};
