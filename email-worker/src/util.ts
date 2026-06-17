/**
 * Generic helpers for the email worker (no app-specific logic).
 */

/** Normalise a postal-mime attachment `content` value to bytes. */
export function toUint8(content: ArrayBuffer | Uint8Array | string): Uint8Array {
  if (content instanceof Uint8Array) return content;
  if (content instanceof ArrayBuffer) return new Uint8Array(content);
  // string -> assume base64
  const binary = atob(content);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Base64-encode bytes in chunks (btoa chokes on very large strings). */
export function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000; // 32 KiB
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk) as unknown as number[]);
  }
  return btoa(binary);
}

/** Readable file extension for an R2 key, based on MIME type. */
export function extFromMime(mime: string): string {
  switch (mime.toLowerCase()) {
    case 'image/jpeg':
    case 'image/jpg': return 'jpg';
    case 'image/png': return 'png';
    case 'image/gif': return 'gif';
    case 'image/heic':
    case 'image/heif': return 'heic';
    case 'image/webp': return 'webp';
    case 'application/pdf': return 'pdf';
    case 'message/rfc822': return 'eml';
    default: return 'bin';
  }
}

/** Short URL-safe id for the Workers runtime (no npm nanoid needed). */
export function nanoid(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 21);
}

/** R2 key: tasks/<YYYY>/<MM>/<id>.<ext> */
export function r2KeyForAttachment(id: string, ext: string): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `tasks/${y}/${m}/${id}.${ext}`;
}
