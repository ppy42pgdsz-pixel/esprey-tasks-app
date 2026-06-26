/**
 * POST /api/access-sync — reconcile the Cloudflare Access allow-list with our
 * database (admin only). Pushes every registered user email and every alias
 * into the Access policy so they can all receive a sign-in code. Idempotent:
 * addresses already on the policy are left as-is. Fixes aliases that were added
 * directly to the DB (e.g. seeded by a migration) and never granted Access.
 */
import { json } from './_lib';
import { ensureAccessEmails } from './_cf';

interface Env {
  DB: D1Database;
  ADMIN_EMAIL?: string;
  APP_DOMAIN?: string;
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
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

  const { results: users } = await ctx.env.DB.prepare('SELECT email FROM users').all<{ email: string }>();
  const { results: aliases } = await ctx.env.DB.prepare('SELECT alias_email FROM user_aliases').all<{ alias_email: string }>();
  const emails = [...users.map((u) => u.email), ...aliases.map((a) => a.alias_email)];

  try {
    const r = await ensureAccessEmails(ctx.env, emails);
    if (!r.configured) return json({ error: 'Cloudflare API token not configured on this app, so the Access list can’t be updated automatically.' }, 503);
    return json({ added: r.added, total: r.total, aliases: aliases.length, users: users.length });
  } catch (e) {
    return json({ error: `Access sync failed: ${(e as Error).message}` }, 500);
  }
};
