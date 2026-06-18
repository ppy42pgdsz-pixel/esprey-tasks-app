/**
 * Cloudflare Access policy sync — keep the allow-list of emails on the
 * tasks.esprey.net Access policy in step with our team/alias list.
 *
 * Only ever touches the allow policy on APP_DOMAIN, so it can never affect
 * another app. No-ops when CLOUDFLARE_API_TOKEN isn't configured yet.
 *
 * Adapted from the expenses app's proven approach; the one twist is that we
 * try the app-embedded policy endpoint first and fall back to the reusable
 * (standalone) endpoint, so it works whichever policy type the Tasks app uses.
 */

const CF_API = 'https://api.cloudflare.com/client/v4';

interface CfEnv {
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  APP_DOMAIN?: string;
}

function cleanToken(raw: string): string {
  return raw.replace(/[^\x21-\x7E]/g, '');
}

async function cfFetch<T = unknown>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${CF_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${cleanToken(token)}`,
      'Content-Type': 'application/json',
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  const text = await res.text();
  let body: { success?: boolean; result?: unknown; errors?: Array<{ message?: string }>; rawText?: string };
  try { body = JSON.parse(text); } catch { body = { rawText: text.slice(0, 500) }; }
  if (!res.ok || body?.success === false) {
    const msg = body?.errors?.[0]?.message ?? body?.rawText ?? `HTTP ${res.status}`;
    throw new Error(`Cloudflare API ${path} failed: ${msg}`);
  }
  return body as T;
}

interface AccessPolicy { id: string; name: string; decision: string; include?: Array<{ email?: { email?: string } }>; exclude?: unknown[]; require?: unknown[]; }

async function findApp(token: string, accountId: string, domain: string): Promise<{ id: string }> {
  const body = await cfFetch<{ result: Array<{ id: string; domain?: string }> }>(token, `/accounts/${accountId}/access/apps?per_page=100`);
  const apps = body.result ?? [];
  const match = apps.find((a) => a.domain === domain || a.domain?.replace(/\/$/, '') === domain);
  if (!match) throw new Error(`No Access app found for ${domain}`);
  return match;
}

async function getAllowPolicy(token: string, accountId: string, appId: string): Promise<AccessPolicy> {
  const body = await cfFetch<{ result: AccessPolicy[] }>(token, `/accounts/${accountId}/access/apps/${appId}/policies`);
  const policies = body.result ?? [];
  const policy = policies.find((p) => p.decision === 'allow') ?? policies[0];
  if (!policy) throw new Error('Access app has no policies');
  return policy;
}

function emailsFromPolicy(policy: AccessPolicy): string[] {
  const out = new Set<string>();
  for (const rule of policy.include ?? []) {
    const e = rule.email?.email;
    if (typeof e === 'string') out.add(e.toLowerCase());
  }
  return Array.from(out).sort();
}

async function setPolicyEmails(token: string, accountId: string, appId: string, policy: AccessPolicy, emails: string[]): Promise<void> {
  const include = emails.map((e) => e.trim().toLowerCase()).filter(Boolean).map((email) => ({ email: { email } }));
  const payload = JSON.stringify({
    name: policy.name,
    decision: policy.decision,
    include,
    exclude: policy.exclude ?? [],
    require: policy.require ?? [],
  });
  // App-embedded policy endpoint first; fall back to the reusable one if needed.
  try {
    await cfFetch(token, `/accounts/${accountId}/access/apps/${appId}/policies/${policy.id}`, { method: 'PUT', body: payload });
  } catch (e) {
    if ((e as Error).message.toLowerCase().includes('reusable')) {
      await cfFetch(token, `/accounts/${accountId}/access/policies/${policy.id}`, { method: 'PUT', body: payload });
    } else {
      throw e;
    }
  }
}

async function sync(env: CfEnv, email: string, op: 'grant' | 'revoke'): Promise<void> {
  if (!env.CLOUDFLARE_API_TOKEN) return; // not wired up yet — team changes still work in our DB
  const token = env.CLOUDFLARE_API_TOKEN;
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  if (!accountId) throw new Error('CLOUDFLARE_ACCOUNT_ID is not set');
  const domain = env.APP_DOMAIN ?? 'tasks.esprey.net';

  const app = await findApp(token, accountId, domain);
  const policy = await getAllowPolicy(token, accountId, app.id);
  const current = emailsFromPolicy(policy);
  const lower = email.toLowerCase();

  if (op === 'grant') {
    if (current.includes(lower)) return;
    await setPolicyEmails(token, accountId, app.id, policy, [...current, lower].sort());
  } else {
    if (!current.includes(lower)) return;
    await setPolicyEmails(token, accountId, app.id, policy, current.filter((e) => e !== lower));
  }
}

export const grantAccess = (env: CfEnv, email: string) => sync(env, email, 'grant');
export const revokeAccess = (env: CfEnv, email: string) => sync(env, email, 'revoke');
