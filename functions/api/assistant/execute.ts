/**
 * POST /api/assistant/execute  { actions }
 * Runs the actions the user approved. Every action is validated and scoped to
 * what the signed-in user owns.
 */
import { meFromCtx, json } from '../_lib';
import { executeActions, type AssistantAction } from './_assistant';
import type { WebPushEnv } from '../_webpush';

type Env = WebPushEnv;

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const me = await meFromCtx(ctx.env.DB, ctx);
  const body = await ctx.request.json<{ actions?: AssistantAction[] }>().catch(() => ({} as { actions?: AssistantAction[] }));
  const actions = Array.isArray(body.actions) ? body.actions : [];
  if (actions.length === 0) return json({ ok: true, results: [] });

  const results = await executeActions(ctx.env, me, actions);
  return json({ ok: true, results });
};
