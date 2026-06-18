/**
 * GET /api/users/:email/companies — company_ids this user may use (admin only)
 * PUT /api/users/:email/companies — set the allowed company_ids { company_ids } (admin only)
 */
import { meFromCtx, isAdminEmail } from '../../_lib';

interface Env { DB: D1Database; ADMIN_EMAIL?: string }

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const me = await meFromCtx(ctx.env.DB, ctx);
  if (!(await isAdminEmail(ctx.env.DB, me, ctx.env.ADMIN_EMAIL))) return json({ error: 'Admin only' }, 403);
  const userEmail = decodeURIComponent((ctx.params as { email: string }).email).toLowerCase();
  const { results } = await ctx.env.DB.prepare('SELECT company_id FROM user_companies WHERE user_email = ?').bind(userEmail).all<{ company_id: string }>();
  return json(results.map((r) => r.company_id));
};

export const onRequestPut: PagesFunction<Env> = async (ctx) => {
  const me = await meFromCtx(ctx.env.DB, ctx);
  if (!(await isAdminEmail(ctx.env.DB, me, ctx.env.ADMIN_EMAIL))) return json({ error: 'Admin only' }, 403);
  const userEmail = decodeURIComponent((ctx.params as { email: string }).email).toLowerCase();
  const body = await ctx.request.json<{ company_ids?: string[] }>();
  const ids = Array.from(new Set((body.company_ids ?? []).filter(Boolean)));

  const stmts = [ctx.env.DB.prepare('DELETE FROM user_companies WHERE user_email = ?').bind(userEmail)];
  for (const cid of ids) {
    stmts.push(ctx.env.DB.prepare('INSERT OR IGNORE INTO user_companies (user_email, company_id) VALUES (?, ?)').bind(userEmail, cid));
  }
  await ctx.env.DB.batch(stmts);
  return json({ ok: true, company_ids: ids });
};
