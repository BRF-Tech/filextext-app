// The .fxtxt container (docs/FORMAT.md):
//
//   offset  size  field
//   0       8     magic "filextxt"
//   8       1     container version (1)
//   9       4     key block length H, unsigned big-endian
//   13      H     key block: UTF-8 JSON, the same fields as a filex
//                 encrypted-folder marker v2 (.filex-e2e.json)
//   13+H    …     body: a filex `filexe2e` v1 blob — the payload encrypted
//                 under a fresh DEK, the DEK wrapped by the FMK
//
// So a .fxtxt is "one marker + one encrypted file" in a single file, and
// whatever reads a filex encrypted folder (the web client, `filex decrypt`)
// can read it with a 13-byte prefix of framing.

import {
  IV_LEN,
  KEY_LEN,
  VERIFY_PLAINTEXT,
  b64ToBytes,
  buf,
  bytesToB64,
  defaultRng,
  deriveKek,
  deriveRecoveryKek,
  formatRecoveryKey,
  gcmOpen,
  gcmSeal,
  importAesKey,
  parseRecoveryKey,
  RECOVERY_KEY_BYTES,
  type Rng,
} from './keys';

export const MAGIC = 'filextxt';
export const CONTAINER_VERSION = 1;
export const KEY_BLOCK_VERSION = 2;
export const E2E_MAGIC = 'filexe2e';
export const E2E_FILE_VERSION = 1;
export const E2E_HEADER_LEN = 97;
export const DEFAULT_ITERATIONS = 600_000;
/** Reading refuses more than this (a planted key block must not hang the tab). */
export const MAX_ITERATIONS = 100_000_000;
export const MIN_PASSWORD_LEN = 8;
/** A key block is small; anything bigger is not one. */
export const MAX_KEY_BLOCK = 64 * 1024;
/** One-shot encryption in memory: the same ceiling filex uses. */
export const MAX_PAYLOAD_BYTES = 200 * 1024 * 1024;

const MAGIC_BYTES = new TextEncoder().encode(MAGIC);
const E2E_MAGIC_BYTES = new TextEncoder().encode(E2E_MAGIC);
const PREFIX = 13;

export type FxtxtErrorCode =
  | 'not_fxtxt'
  | 'unsupported'
  | 'damaged'
  | 'wrong_credential'
  | 'weak_password'
  | 'too_large';

export class FxtxtError extends Error {
  readonly code: FxtxtErrorCode;
  constructor(code: FxtxtErrorCode, message: string) {
    super(message);
    this.name = 'FxtxtError';
    this.code = code;
  }
}

export interface RecoverySlot {
  /** base64, 16-byte HKDF salt */
  salt: string;
  /** base64(12B IV ‖ AES-GCM(RKEK, FMK)) */
  blob: string;
}

/** The key block — field for field a filex marker v2 with `fmk: "wrapped"`. */
export interface KeyBlock {
  v: 2;
  salt: string;
  iter: number;
  verify: string;
  fmk: 'wrapped';
  fmk_pw: string;
  rk?: RecoverySlot;
}

export type Credential = { password: string } | { recoveryKey: string };

/** Serialise with a fixed key order, so the same block gives the same bytes. */
export function keyBlockJson(b: KeyBlock): string {
  const ordered: Record<string, unknown> = {
    v: b.v,
    salt: b.salt,
    iter: b.iter,
    verify: b.verify,
    fmk: b.fmk,
    fmk_pw: b.fmk_pw,
  };
  if (b.rk) ordered.rk = { salt: b.rk.salt, blob: b.rk.blob };
  return JSON.stringify(ordered);
}

function startsWith(data: Uint8Array, prefix: Uint8Array): boolean {
  if (data.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) if (data[i] !== prefix[i]) return false;
  return true;
}

/** True when the bytes begin like a .fxtxt (magic only; not a validation). */
export function isFxtxt(data: Uint8Array): boolean {
  return startsWith(data, MAGIC_BYTES);
}

export function encodeContainer(block: KeyBlock, body: Uint8Array): Uint8Array {
  const header = new TextEncoder().encode(keyBlockJson(block));
  const out = new Uint8Array(PREFIX + header.length + body.length);
  out.set(MAGIC_BYTES, 0);
  out[8] = CONTAINER_VERSION;
  new DataView(out.buffer).setUint32(9, header.length, false);
  out.set(header, PREFIX);
  out.set(body, PREFIX + header.length);
  return out;
}

function isB64(v: unknown, minBytes: number): v is string {
  if (typeof v !== 'string' || !v) return false;
  try {
    return b64ToBytes(v).length >= minBytes;
  } catch {
    return false;
  }
}

/** Check a parsed key block's shape; throws `damaged` on anything odd. */
export function validateKeyBlock(o: unknown): KeyBlock {
  const bad = (why: string) => new FxtxtError('damaged', `the key block is damaged (${why})`);
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw bad('not an object');
  const m = o as Record<string, unknown>;
  if (m.v !== KEY_BLOCK_VERSION) throw bad('version');
  if (m.fmk !== 'wrapped') throw bad('fmk');
  if (typeof m.iter !== 'number' || !Number.isInteger(m.iter) || m.iter < 1 || m.iter > MAX_ITERATIONS) throw bad('iter');
  if (!isB64(m.salt, 8)) throw bad('salt');
  if (!isB64(m.verify, IV_LEN + 16)) throw bad('verify');
  if (!isB64(m.fmk_pw, IV_LEN + KEY_LEN + 16)) throw bad('fmk_pw');
  let rk: RecoverySlot | undefined;
  if (m.rk !== undefined) {
    const r = m.rk as Record<string, unknown>;
    if (!r || typeof r !== 'object' || !isB64(r.salt, 8) || !isB64(r.blob, IV_LEN + KEY_LEN + 16)) throw bad('rk');
    rk = { salt: r.salt as string, blob: r.blob as string };
  }
  return {
    v: 2,
    salt: m.salt as string,
    iter: m.iter,
    verify: m.verify as string,
    fmk: 'wrapped',
    fmk_pw: m.fmk_pw as string,
    ...(rk ? { rk } : {}),
  };
}

export function decodeContainer(data: Uint8Array): { block: KeyBlock; body: Uint8Array; headerBytes: Uint8Array } {
  if (!isFxtxt(data)) throw new FxtxtError('not_fxtxt', 'this file is not a filextext workspace');
  if (data.length < PREFIX) throw new FxtxtError('damaged', 'the file is cut short');
  if (data[8] !== CONTAINER_VERSION) {
    throw new FxtxtError('unsupported', `this workspace was written by a newer filextext (container v${data[8]})`);
  }
  const n = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(9, false);
  if (n === 0 || n > MAX_KEY_BLOCK || PREFIX + n > data.length) throw new FxtxtError('damaged', 'the key block is damaged (length)');
  const headerBytes = data.slice(PREFIX, PREFIX + n);
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(headerBytes));
  } catch {
    throw new FxtxtError('damaged', 'the key block is damaged (json)');
  }
  const block = validateKeyBlock(parsed);
  const body = data.slice(PREFIX + n);
  if (body.length < E2E_HEADER_LEN + 16 || !startsWith(body, E2E_MAGIC_BYTES)) {
    throw new FxtxtError('damaged', 'the encrypted content is missing or cut short');
  }
  return { block, body, headerBytes };
}

function checkPassword(p: string) {
  if ((p ?? '').length < MIN_PASSWORD_LEN) {
    throw new FxtxtError('weak_password', `the password must be at least ${MIN_PASSWORD_LEN} characters`);
  }
}

/** A fresh password slot for the raw FMK (new salt, new IVs). */
async function passwordSlot(password: string, rawFmk: Uint8Array, iterations: number, rng: Rng) {
  checkPassword(password);
  const iter = Math.max(DEFAULT_ITERATIONS, iterations);
  const salt = rng(16);
  const kek = await deriveKek(password, salt, iter);
  const verify = await gcmSeal(kek, new TextEncoder().encode(VERIFY_PLAINTEXT), rng);
  const fmk_pw = await gcmSeal(kek, rawFmk, rng);
  return { salt: bytesToB64(salt), iter, verify, fmk_pw };
}

/**
 * A new workspace's keys: a random FMK, its password slot and its recovery
 * slot. The recovery key is returned ONCE, to be shown once; it is not in the
 * block and nothing keeps it.
 *
 * Random draws, in order (the test vectors depend on it): FMK 32, salt 16,
 * verify IV 12, fmk_pw IV 12, recovery key 20, recovery salt 16, recovery IV 12.
 */
export async function createKeyBlock(
  password: string,
  opts: { rng?: Rng; iterations?: number } = {},
): Promise<{ block: KeyBlock; fmk: CryptoKey; recoveryKey: string }> {
  checkPassword(password);
  const rng = opts.rng ?? defaultRng;
  const rawFmk = rng(KEY_LEN);
  try {
    const pw = await passwordSlot(password, rawFmk, opts.iterations ?? DEFAULT_ITERATIONS, rng);
    const rkRaw = rng(RECOVERY_KEY_BYTES);
    const rkSalt = rng(16);
    const rkek = await deriveRecoveryKek(rkRaw, rkSalt);
    const rk = { salt: bytesToB64(rkSalt), blob: await gcmSeal(rkek, rawFmk, rng) };
    const recoveryKey = formatRecoveryKey(rkRaw);
    rkRaw.fill(0);
    const block: KeyBlock = { v: 2, salt: pw.salt, iter: pw.iter, verify: pw.verify, fmk: 'wrapped', fmk_pw: pw.fmk_pw, rk };
    return { block, fmk: await importAesKey(rawFmk), recoveryKey };
  } finally {
    rawFmk.fill(0);
  }
}

/**
 * The raw FMK from a password or the recovery key. Throws `wrong_credential`.
 * The caller zeroes it. Raw bytes exist only here and only for as long as a
 * slot is being (re)wrapped: the key the app keeps is non-extractable.
 */
async function rawFmkFrom(block: KeyBlock, cred: Credential): Promise<Uint8Array> {
  const wrong = () => new FxtxtError('wrong_credential', 'wrong password or recovery key');
  if ('recoveryKey' in cred) {
    const raw = parseRecoveryKey(cred.recoveryKey);
    if (!raw || !block.rk) throw wrong();
    const rkek = await deriveRecoveryKek(raw, b64ToBytes(block.rk.salt));
    raw.fill(0);
    const fmk = await gcmOpen(rkek, block.rk.blob);
    if (!fmk || fmk.length !== KEY_LEN) throw wrong();
    return fmk;
  }
  const kek = await deriveKek(cred.password ?? '', b64ToBytes(block.salt), block.iter);
  const proof = await gcmOpen(kek, block.verify);
  if (!proof || new TextDecoder().decode(proof) !== VERIFY_PLAINTEXT) throw wrong();
  const fmk = await gcmOpen(kek, block.fmk_pw);
  if (!fmk || fmk.length !== KEY_LEN) throw wrong();
  return fmk;
}

/** The FMK as a non-extractable key. Throws `wrong_credential`. */
export async function unlock(block: KeyBlock, cred: Credential): Promise<CryptoKey> {
  const raw = await rawFmkFrom(block, cred);
  try {
    return await importAesKey(raw);
  } finally {
    raw.fill(0);
  }
}

/**
 * A new password — and with it a new workspace key (a design decision,
 * 2026-09-27: an old password must not open what is saved after a change). Proof is the current password or the recovery key (after a
 * recovery-key unlock this is the mandatory reset). The result is a whole new
 * key block: a fresh FMK, a fresh password slot and a fresh RECOVERY KEY,
 * returned once to be shown once. The caller re-encrypts the payload under
 * the new FMK (one file, so one `sealBody`) and saves.
 *
 * So nothing old opens what is saved from now on: not the old password, not
 * the old recovery key, not the old FMK. A copy saved BEFORE the change still
 * opens with what it was saved with — that is arithmetic, and FORMAT.md says so.
 *
 * Random draws: as `createKeyBlock`.
 */
export async function rekey(
  block: KeyBlock,
  cred: Credential,
  newPassword: string,
  opts: { rng?: Rng; iterations?: number } = {},
): Promise<{ block: KeyBlock; fmk: CryptoKey; recoveryKey: string }> {
  checkPassword(newPassword);
  const proof = await rawFmkFrom(block, cred);
  proof.fill(0);
  return createKeyBlock(newPassword, opts);
}

/**
 * Encrypt a payload as a filexe2e v1 blob: a fresh DEK and fresh IVs on every
 * call. Random draws, in order: DEK 32, wrap IV 12, data IV 12.
 */
export async function sealBody(fmk: CryptoKey, payload: Uint8Array, opts: { rng?: Rng } = {}): Promise<Uint8Array> {
  if (payload.byteLength > MAX_PAYLOAD_BYTES) throw new FxtxtError('too_large', 'the workspace is larger than 200 MB');
  const rng = opts.rng ?? defaultRng;
  const rawDek = rng(KEY_LEN);
  const wrapIV = rng(IV_LEN);
  const dataIV = rng(IV_LEN);
  try {
    const dek = await importAesKey(rawDek, ['encrypt']);
    const wrapped = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buf(wrapIV) }, fmk, buf(rawDek)));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buf(dataIV) }, dek, buf(payload)));
    const out = new Uint8Array(E2E_HEADER_LEN + ct.length);
    out.set(E2E_MAGIC_BYTES, 0);
    out[8] = E2E_FILE_VERSION;
    out.set(wrapIV, 9);
    out.set(wrapped, 21);
    out.set(dataIV, 69);
    // [81..97) reserved zeros, as in filex
    out.set(ct, E2E_HEADER_LEN);
    return out;
  } finally {
    rawDek.fill(0);
  }
}

/** Decrypt a filexe2e v1 body. Throws `damaged` when it does not open. */
export async function openBody(fmk: CryptoKey, body: Uint8Array): Promise<Uint8Array> {
  if (body.length < E2E_HEADER_LEN + 16 || !startsWith(body, E2E_MAGIC_BYTES)) {
    throw new FxtxtError('damaged', 'the encrypted content is missing or cut short');
  }
  if (body[8] !== E2E_FILE_VERSION) throw new FxtxtError('unsupported', `unsupported content version ${body[8]}`);
  let rawDek: ArrayBuffer;
  try {
    rawDek = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf(body.slice(9, 21)) }, fmk, buf(body.slice(21, 69)));
  } catch {
    throw new FxtxtError('damaged', 'the content key does not open (the file is damaged)');
  }
  const dek = await importAesKey(new Uint8Array(rawDek), ['decrypt']);
  new Uint8Array(rawDek).fill(0);
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf(body.slice(69, 81)) }, dek, buf(body.slice(E2E_HEADER_LEN))),
    );
  } catch {
    throw new FxtxtError('damaged', 'the content does not decrypt (the file is damaged)');
  }
}
