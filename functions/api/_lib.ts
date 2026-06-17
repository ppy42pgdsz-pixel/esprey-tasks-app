/**
 * Shared helpers for API functions. (Files starting with _ aren't routes.)
 */

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

/** The signed-in email from the Access JWT (set by _middleware). */
export function rawEmail(ctx: { data: Record<string, unknown> }): string {
  return ((ctx.data as { userEmail?: string }).userEmail ?? '').toLowerCase();
}

/**
 * Resolve any address (login email or email sender) to its primary user email.
 * Falls back to the address itself if it isn't a known user or alias.
 */
export async function resolvePrimary(db: D1Database, email: string): Promise<string> {
  const e = (email ?? '').toLowerCase();
  if (!e) return e;
  const u = await db.prepare('SELECT email FROM users WHERE email = ?').bind(e).first<{ email: string }>();
  if (u) return u.email.toLowerCase();
  const a = await db.prepare('SELECT user_email FROM user_aliases WHERE alias_email = ?').bind(e).first<{ user_email: string }>();
  if (a) return a.user_email.toLowerCase();
  return e;
}
