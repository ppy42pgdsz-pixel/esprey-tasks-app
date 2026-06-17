/**
 * PATCH  /api/users/:email — edit an employee { name?, role? } (admin only)
 * DELETE /api/users/:email — remove an employee (admin only)
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

export const onRequestPatch: PagesFunction<Env> = async (ctx) => {
  if (!(await isAdmin(ctx))) return json({ error: 'Admin only' }, 403);
  const email = decodeURIComponent((ctx.params as { email: string }).email).toLowerCase();
  const body = await ctx.request.json<{ name?: string; role?: string }>();

  const updates: string[] = [];
  const values: unknown[] = [];
  if ('name' in body) {
    const name = body.name?.trim();
    if (!name) return json({ error: 'name cannot be empty' }, 400);
    updates.push('name = ?'); values.push(name);
  }
  if ('role' in body) {
    updates.push('role = ?'); values.push(body.role === 'admin' ? 'admin' : 'member');
  }
  if (updates.length === 0) return json({ error: 'No valid fields' }, 400);

  values.push(email);
  await ctx.env.DB.prepare(`UPDATE users SET ${updates.join(', ')} WHERE email = ?`).bind(...values).run();
  const user = await ctx.env.DB.prepare('SELECT email, name, role, created_at FROM users WHERE email = ?').bind(email).first();
  if (!user) return json({ error: 'Not found' }, 404);
  return json(user);
};

export const onRequestDelete: PagesFunction<Env> = async (ctx) => {
  if (!(await isAdmin(ctx))) return json({ error: 'Admin only' }, 403);
  const email = decodeURIComponent((ctx.params as { email: string }).email).toLowerCase();
  if (email === (ctx.env.ADMIN_EMAIL ?? '').toLowerCase()) return json({ error: 'Cannot remove the admin' }, 400);
  await ctx.env.DB.prepare('DELETE FROM users WHERE email = ?').bind(email).run();
  return json({ ok: true });
};
