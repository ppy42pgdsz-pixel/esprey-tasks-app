/**
 * GET  /api/companies  — list all companies
 * POST /api/companies  — create a company
 */

interface Env { DB: D1Database }

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

function nanoid() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 21);
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const { results } = await ctx.env.DB.prepare(
    'SELECT * FROM companies ORDER BY name ASC'
  ).all();
  return json(results);
};

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
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
