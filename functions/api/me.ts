/**
 * GET /api/me — who is the current (Cloudflare Access) user, and their role.
 * Email comes from the Access JWT (set on ctx.data by _middleware).
 */

interface Env {
  DB: D1Database;
  ADMIN_EMAIL: string;
  ADMIN_NAME: string;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const email = ((ctx.data as { userEmail?: string }).userEmail ?? '').toLowerCase();
  if (!email) return json({ error: 'Unauthenticated' }, 401);

  const row = await ctx.env.DB.prepare('SELECT email, name, role FROM users WHERE email = ?')
    .bind(email)
    .first<{ email: string; name: string; role: string }>();

  if (row) return json(row);

  // Not a registered employee yet. The configured admin is always treated as admin.
  if (email === (ctx.env.ADMIN_EMAIL ?? '').toLowerCase()) {
    return json({ email, name: ctx.env.ADMIN_NAME ?? 'Admin', role: 'admin' });
  }
  return json({ email, name: email, role: 'member' });
};
