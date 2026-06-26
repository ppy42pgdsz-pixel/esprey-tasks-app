/**
 * Cloudflare Access JWT verification middleware.
 * Same pattern as the expenses app — only Carl's email can pass.
 */

import { resolvePrimary } from './_lib';

interface Env {
  DB: D1Database;
  ANTHROPIC_API_KEY: string;
  APP_DOMAIN: string;
  ADMIN_EMAIL: string;
}

export const onRequest: PagesFunction<Env> = async (ctx) => {
  // Cloudflare Access sets this header after verifying the JWT
  const cfAccessJwt = ctx.request.headers.get('Cf-Access-Jwt-Assertion');

  if (!cfAccessJwt) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Decode the JWT payload (we trust CF to verify the signature)
  try {
    const [, payloadB64] = cfAccessJwt.split('.');
    const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')));
    const loginEmail: string = (payload.email ?? '').toLowerCase();

    if (!loginEmail) {
      return new Response(JSON.stringify({ error: 'No email in token' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Map any alias the person signed in with to their PRIMARY account email, so
    // every downstream owner/assignee/admin check (which all key off the primary
    // email) recognises them. Falls back to the login email if the lookup fails.
    let email = loginEmail;
    try { email = await resolvePrimary(ctx.env.DB, loginEmail); } catch { /* keep login email */ }

    // Store email on ctx.data for downstream handlers
    ctx.data.userEmail = email;
    return ctx.next();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid token' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
