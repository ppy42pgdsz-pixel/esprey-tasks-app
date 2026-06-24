/**
 * POST   /api/push/subscribe — save this browser's push subscription for me.
 * DELETE /api/push/subscribe — remove a subscription (on disable).
 */
import { meFromCtx, json } from '../_lib';

interface Env { DB: D1Database }

interface SubBody {
  subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  endpoint?: string;
}

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const me = await meFromCtx(ctx.env.DB, ctx);
  const body = await ctx.request.json<SubBody>().catch(() => ({} as SubBody));
  const sub = body.subscription;
  const endpoint = sub?.endpoint;
  const p256dh = sub?.keys?.p256dh;
  const auth = sub?.keys?.auth;
  if (!endpoint || !p256dh || !auth) return json({ error: 'invalid subscription' }, 400);

  // Upsert — re-subscribing or moving the endpoint between users updates the row.
  await ctx.env.DB.prepare(
    `INSERT INTO push_subscriptions (endpoint, user_email, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET user_email = excluded.user_email, p256dh = excluded.p256dh, auth = excluded.auth`,
  ).bind(endpoint, me, p256dh, auth, Date.now()).run();

  return json({ ok: true });
};

export const onRequestDelete: PagesFunction<Env> = async (ctx) => {
  const me = await meFromCtx(ctx.env.DB, ctx);
  const body = await ctx.request.json<SubBody>().catch(() => ({} as SubBody));
  const endpoint = body.endpoint ?? body.subscription?.endpoint;
  if (!endpoint) return json({ error: 'endpoint required' }, 400);
  await ctx.env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_email = ?').bind(endpoint, me).run();
  return json({ ok: true });
};
