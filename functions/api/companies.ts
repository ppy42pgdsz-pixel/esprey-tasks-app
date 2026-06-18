/**
 * GET  /api/companies  — list all companies
 * POST /api/companies  — create a company
 */

import { meFromCtx, isAdminEmail } from './_lib';

interface Env { DB: D1Database; ADMIN_EMAIL?: string }

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

function nanoid() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 21);
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const me = await meFromCtx(ctx.env.DB, ctx);
  const admin = await isAdminEmail(ctx.env.DB, me, ctx.env.ADMIN_EMAIL);

  // Admin sees all; members see only allocated companies plus any named "Personal".
  const query = admin
    ? 'SELECT * FROM companies ORDER BY name ASC'
    : `SELECT * FROM companies
         WHERE id IN (SELECT company_id FROM user_companies WHERE user_email = ?)
            OR lower(name) = 'personal'
         ORDER BY name ASC`;
  const stmt = ctx.env.DB.prepare(query);
  const { results } = await (admin ? stmt : stmt.bind(me)).all();
  return json(results);
};

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const me = await meFromCtx(ctx.env.DB, ctx);
  if (!(await isAdminEmail(ctx.env.DB, me, ctx.env.ADMIN_EMAIL))) return json({ error: 'Admin only' }, 403);
  const body = await ctx.request.json<{ name: string }>();
  if (!body.name?.trim()) return json({ error: 'name is required' }, 400);

  const id = nanoid();
  const now = Date.now();
  await ctx.env.DB.prepare(
    'INSERT INTO companies (id, name, created_at) VALUES (?, ?, ?)'
  ).bind(id, body.name.trim(), now).run();

  const company = await ctx.env.DB.prepare('SELECT * FROM companies WHERE id = ?').bind(id).first();
  return json(company, 201);
};
