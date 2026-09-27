// Key primitives: the same hierarchy as filex's end-to-end encrypted folders
// (filex docs/E2E-ENCRYPTION.md, packages/core/src/lib/e2ecrypto.ts):
//
//   password ─PBKDF2-SHA256(600k, 16B salt)─▶ KEK  ─┐
//   recovery key ─HKDF-SHA256(16B salt)──────▶ RKEK ─┴─▶ unwrap the FMK
//                                                        │
//   per-save random 32B DEK ◀── AES-GCM-wrapped by the FMK (filexe2e header)
//
// WebCrypto only. Nothing here is ever stored, logged or sent anywhere.

/** Where random bytes come from; tests pass a fixed sequence. */
export type Rng = (n: number) => Uint8Array;

export const defaultRng: Rng = (n) => crypto.getRandomValues(new Uint8Array(n));

export const VERIFY_PLAINTEXT = 'filex-e2e-verify-v1';
/** HKDF domain separation for the recovery key — filex's string. */
export const RK_INFO = 'filex-e2e-recovery-v1';
export const RECOVERY_KEY_BYTES = 20;
export const IV_LEN = 12;
export const KEY_LEN = 32;

/** Crockford base32: no I, L, O or U, so a key survives being read aloud. */
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A fresh ArrayBuffer copy — WebCrypto wants a plain buffer, not a view. */
export function buf(b: Uint8Array): ArrayBuffer {
  return new Uint8Array(b).buffer as ArrayBuffer;
}

export function bytesToB64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}

export function b64ToBytes(s: string): Uint8Array {
  const raw = atob(s);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** 20 bytes → `XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX` (160 bits). */
export function formatRecoveryKey(raw: Uint8Array): string {
  let bits = 0;
  let acc = 0;
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    acc = ((acc << 8) | raw[i]) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += B32[(acc >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(acc << (5 - bits)) & 31];
  return (out.match(/.{1,4}/g) || []).join('-');
}

/**
 * A typed-in key back to its 20 bytes, or null. Case, dashes, spaces and the
 * Crockford look-alikes (O→0, I/L→1) are forgiven.
 */
export function parseRecoveryKey(s: string): Uint8Array | null {
  const clean = (s || '')
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (clean.length !== Math.ceil((RECOVERY_KEY_BYTES * 8) / 5)) return null;
  const out = new Uint8Array(RECOVERY_KEY_BYTES);
  let acc = 0;
  let bits = 0;
  let n = 0;
  for (const ch of clean) {
    const v = B32.indexOf(ch);
    if (v < 0) return null;
    acc = ((acc << 5) | v) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out[n++] = (acc >>> (bits - 8)) & 0xff;
      bits -= 8;
    }
  }
  return n === RECOVERY_KEY_BYTES ? out : null;
}

/** The password's key. Non-extractable: it can wrap and unwrap, never be read. */
export async function deriveKek(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: buf(salt), iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** The recovery key's key (HKDF-SHA256, filex's info string). */
export async function deriveRecoveryKek(raw: Uint8Array, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', buf(raw), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: buf(salt), info: buf(new TextEncoder().encode(RK_INFO)) },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Raw 32 bytes as an AES-256-GCM key (the FMK, a DEK). Non-extractable. */
export function importAesKey(raw: Uint8Array, usages: KeyUsage[] = ['encrypt', 'decrypt']): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', buf(raw), { name: 'AES-GCM' }, false, usages);
}

/** base64(12B IV ‖ AES-GCM ciphertext+tag) — every slot in the key block. */
export async function gcmSeal(key: CryptoKey, plain: Uint8Array, rng: Rng = defaultRng): Promise<string> {
  const iv = rng(IV_LEN);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buf(iv) }, key, buf(plain)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return bytesToB64(out);
}

/** The plaintext, or null (never a throw) when the key is not the one. */
export async function gcmOpen(key: CryptoKey, b64: string): Promise<Uint8Array | null> {
  let raw: Uint8Array;
  try {
    raw = b64ToBytes(b64);
  } catch {
    return null;
  }
  if (raw.length <= IV_LEN) return null;
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf(raw.slice(0, IV_LEN)) }, key, buf(raw.slice(IV_LEN)));
    return new Uint8Array(pt);
  } catch {
    return null;
  }
}
