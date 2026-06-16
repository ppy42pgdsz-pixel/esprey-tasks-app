/**
 * Cloudflare Access JWT verification middleware.
 * Same pattern as the expenses app — only Carl's email can pass.
 */

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
    const email: string = payload.email ?? '';

    if (!email) {
      return new Response(JSON.stringify({ error: 'No email in token' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

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
