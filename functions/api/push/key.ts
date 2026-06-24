/** GET /api/push/key — the VAPID public key the client needs to subscribe. */
import { json } from '../_lib';

interface Env { VAPID_PUBLIC_KEY?: string }

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  return json({ key: ctx.env.VAPID_PUBLIC_KEY ?? '' });
};
