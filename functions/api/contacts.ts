/**
 * GET  /api/contacts  — list all contacts
 * POST /api/contacts  — create a contact
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
    'SELECT * FROM contacts ORDER BY is_favourite DESC, name ASC'
  ).all();
  return json(results);
};

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const body = await ctx.request.json<{
    name: string;
    email?: string;
    company_id?: string;
    is_favourite?: boolean;
  }>();
  if (!body.name?.trim()) return json({ error: 'name is required' }, 400);

  const id = nanoid();
  const now = Date.now();
  await ctx.env.DB.prepare(
    'INSERT INTO contacts (id, name, email, company_id, is_favourite, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, body.name.trim(), body.email ?? null, body.company_id ?? null, body.is_favourite ? 1 : 0, now).run();

  const contact = await ctx.env.DB.prepare('SELECT * FROM contacts WHERE id = ?').bind(id).first();
  return json(contact, 201);
};
