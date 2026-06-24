/**
 * Web Push sender for Cloudflare Workers — pure Web Crypto, no dependencies.
 * Implements VAPID (RFC 8292) + aes128gcm payload encryption (RFC 8291 / 8188).
 *
 * Env secrets required: VAPID_PUBLIC_KEY (base64url raw P-256 point),
 * VAPID_PRIVATE_KEY (base64url 32-byte scalar), VAPID_SUBJECT (mailto:…).
 */

export interface WebPushEnv {
  DB: D1Database;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

// ─── base64url helpers ───
function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function concat(...arrs: Uint8Array[]): Uint8Array {
  const total = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
}

// HKDF (extract + expand) → length bytes.
const bs = (u: Uint8Array): BufferSource => u as unknown as BufferSource;

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', bs(ikm), 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: bs(salt), info: bs(info) }, key, length * 8);
  return new Uint8Array(bits);
}

// ─── VAPID JWT (ES256) ───
async function importVapidPrivateKey(env: WebPushEnv): Promise<CryptoKey> {
  const pub = b64urlToBytes(env.VAPID_PUBLIC_KEY!); // 0x04 || x(32) || y(32)
  const jwk: JsonWebKey = {
    kty: 'EC', crv: 'P-256',
    x: bytesToB64url(pub.slice(1, 33)),
    y: bytesToB64url(pub.slice(33, 65)),
    d: env.VAPID_PRIVATE_KEY!,
    ext: true,
  };
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

async function vapidAuthHeader(endpoint: string, env: WebPushEnv): Promise<string> {
  const aud = new URL(endpoint).origin;
  const enc = (obj: unknown) => bytesToB64url(new TextEncoder().encode(JSON.stringify(obj)));
  const header = enc({ typ: 'JWT', alg: 'ES256' });
  const payload = enc({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60, sub: env.VAPID_SUBJECT || 'mailto:cesprey@gmail.com' });
  const unsigned = `${header}.${payload}`;
  const key = await importVapidPrivateKey(env);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, bs(new TextEncoder().encode(unsigned))));
  return `vapid t=${unsigned}.${bytesToB64url(sig)}, k=${env.VAPID_PUBLIC_KEY}`;
}

// ─── aes128gcm payload encryption (RFC 8291) ───
async function encryptPayload(plaintext: Uint8Array, uaPublic: Uint8Array, authSecret: Uint8Array): Promise<Uint8Array> {
  const asKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', asKeys.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', bs(uaPublic), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asKeys.privateKey, 256));

  const keyInfo = concat(new TextEncoder().encode('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, sharedSecret, keyInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, new TextEncoder().encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, new TextEncoder().encode('Content-Encoding: nonce\0'), 12);

  const record = concat(plaintext, new Uint8Array([0x02])); // final-record delimiter, no padding
  const cekKey = await crypto.subtle.importKey('raw', bs(cek), { name: 'AES-GCM' }, false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: bs(nonce), tagLength: 128 }, cekKey, bs(record)));

  const header = new Uint8Array(16 + 4 + 1 + 65);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096, false); // record size
  header[20] = 65; // key id length
  header.set(asPublic, 21);
  return concat(header, ciphertext);
}

interface SubRow { endpoint: string; p256dh: string; auth: string }

/** Send a single push. Returns the HTTP status (201 = ok; 404/410 = gone). */
export async function sendPush(env: WebPushEnv, sub: SubRow, payload: PushPayload): Promise<number> {
  const body = await encryptPayload(
    new TextEncoder().encode(JSON.stringify(payload)),
    b64urlToBytes(sub.p256dh),
    b64urlToBytes(sub.auth),
  );
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '2419200',
      Authorization: await vapidAuthHeader(sub.endpoint, env),
    },
    body: body as unknown as BodyInit,
  });
  return res.status;
}

/** Send a push to every device a user has subscribed; prune dead subscriptions. */
export async function pushToUser(env: WebPushEnv, userEmail: string | null | undefined, payload: PushPayload): Promise<void> {
  const to = (userEmail ?? '').toLowerCase();
  if (!to || !env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return;
  const { results } = await env.DB
    .prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_email = ?')
    .bind(to)
    .all<SubRow>();
  for (const s of results) {
    try {
      const status = await sendPush(env, s, payload);
      if (status === 404 || status === 410) {
        await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(s.endpoint).run();
      }
    } catch (e) {
      console.error('push send failed', e);
    }
  }
}
