/**
 * POST /api/push/test — send a test push to my own devices, so a single user can
 * verify Web Push works (even with the app closed) without a second person.
 */
import { meFromCtx, json } from '../_lib';
import { pushToUser, type WebPushEnv } from '../_webpush';

export const onRequestPost: PagesFunction<WebPushEnv> = async (ctx) => {
  const me = await meFromCtx(ctx.env.DB, ctx);
  if (!ctx.env.VAPID_PUBLIC_KEY || !ctx.env.VAPID_PRIVATE_KEY) {
    return json({ error: 'Push not configured (VAPID keys missing)' }, 500);
  }
  const { results } = await ctx.env.DB
    .prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_email = ?')
    .bind(me)
    .all<{ n: number }>();
  const count = results[0]?.n ?? 0;
  if (count === 0) return json({ ok: false, count: 0, error: 'No subscribed device for you yet' });

  await pushToUser(ctx.env, me, {
    title: 'Esprey Tasks',
    body: 'Test notification — Web Push is working ✅',
    url: '/',
    tag: 'test',
  });
  return json({ ok: true, count });
};
