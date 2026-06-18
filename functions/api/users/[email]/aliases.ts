/**
 * POST   /api/users/:email/aliases        — add an alias to a user { alias } (admin only)
 * DELETE /api/users/:email/aliases?alias=  — remove an alias (admin only)
 */

import { grantAccess, revokeAccess } from '../../_cf';

interface Env {
  DB: D1Database;
  ADMIN_EMAIL: string;
  APP_DOMAIN?: string;
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
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

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  if (!(await isAdmin(ctx))) return json({ error: 'Admin only' }, 403);
  const userEmail = decodeURIComponent((ctx.params as { email: string }).email).toLowerCase();
  const body = await ctx.request.json<{ alias: string }>();
  const alias = body.alias?.trim().toLowerCase();
  if (!alias) return json({ error: 'alias is required' }, 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(alias)) return json({ error: 'invalid email' }, 400);

  const user = await ctx.env.DB.prepare('SELECT email FROM users WHERE email = ?').bind(userEmail).first();
  if (!user) return json({ error: 'user not found' }, 404);
  if (alias === userEmail) return json({ error: "that's already the primary email" }, 400);

  // Reassign the alias to this user (moves it if it pointed elsewhere).
  await ctx.env.DB.prepare(
    'INSERT OR REPLACE INTO user_aliases (alias_email, user_email) VALUES (?, ?)',
  ).bind(alias, userEmail).run();

  // Let them sign in with this address too. Roll back on failure.
  try {
    await grantAccess(ctx.env, alias);
  } catch (e) {
    await ctx.env.DB.prepare('DELETE FROM user_aliases WHERE alias_email = ? AND user_email = ?').bind(alias, userEmail).run();
    return json({ error: `Cloudflare Access update failed: ${(e as Error).message}` }, 500);
  }

  return json({ ok: true, alias });
};

export const onRequestDelete: PagesFunction<Env> = async (ctx) => {
  if (!(await isAdmin(ctx))) return json({ error: 'Admin only' }, 403);
  const userEmail = decodeURIComponent((ctx.params as { email: string }).email).toLowerCase();
  const alias = new URL(ctx.request.url).searchParams.get('alias')?.trim().toLowerCase();
  if (!alias) return json({ error: 'alias is required' }, 400);

  try {
    await revokeAccess(ctx.env, alias);
  } catch (e) {
    return json({ error: `Cloudflare Access update failed: ${(e as Error).message}` }, 500);
  }
  await ctx.env.DB.prepare(
    'DELETE FROM user_aliases WHERE alias_email = ? AND user_email = ?',
  ).bind(alias, userEmail).run();

  return json({ ok: true });
};
