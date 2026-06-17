/**
 * GET  /api/users — list employees (any signed-in user, for sharing pickers)
 * POST /api/users — add an employee { name, email, role } (admin only)
 */

interface Env {
  DB: D1Database;
  ADMIN_EMAIL: string;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

async function isAdmin(ctx: EventContext<Env, string, Record<string, unknown>>): Promise<boolean> {
  const email = ((ctx.data as { userEmail?: string }).userEmail ?? '').toLowerCase();
  if (!email) return false;
  if (email === (ctx.env.ADMIN_EMAIL ?? '').toLowerCase()) return true;
  const row = await ctx.env.DB.prepare('SELECT role FROM users WHERE email = ?').bind(email).first<{ role: string }>();
  return row?.role === 'admin';
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const { results } = await ctx.env.DB.prepare(
    'SELECT email, name, role, created_at FROM users ORDER BY name ASC',
  ).all();
  return json(results);
};

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  if (!(await isAdmin(ctx))) return json({ error: 'Admin only' }, 403);

  const body = await ctx.request.json<{ name: string; email: string; role?: string }>();
  const name = body.name?.trim();
  const email = body.email?.trim().toLowerCase();
  const role = body.role === 'admin' ? 'admin' : 'member';
  if (!name || !email) return json({ error: 'name and email are required' }, 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'invalid email' }, 400);

  await ctx.env.DB.prepare(
    'INSERT OR REPLACE INTO users (email, name, role, created_at) VALUES (?, ?, ?, ?)',
  ).bind(email, name, role, Date.now()).run();

  const user = await ctx.env.DB.prepare('SELECT email, name, role, created_at FROM users WHERE email = ?').bind(email).first();
  return json(user, 201);
};
