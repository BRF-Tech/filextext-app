// The .fxtxt container and its key hierarchy (docs/FORMAT.md).
//
// The fixed vectors come from tools/fxtxt_ref.py — a separate Python
// implementation — so these tests hold the TypeScript to the spec, not to
// itself.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  FxtxtError,
  MIN_PASSWORD_LEN,
  createKeyBlock,
  decodeContainer,
  encodeContainer,
  isFxtxt,
  openBody,
  rekey,
  sealBody,
  unlock,
} from '../src/crypto/fxtxt';
import { formatRecoveryKey, parseRecoveryKey } from '../src/crypto/keys';

const V = JSON.parse(readFileSync(new URL('./vectors/container-v1.json', import.meta.url), 'utf8'));
const hex = (h: string) => Uint8Array.from(h.match(/../g)!.map((b) => parseInt(b, 16)));
const toHex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

/** Hands out the vector's random draws in the documented order. */
function vectorRng() {
  const queue = (V.draw_order as string[]).map((k) => hex(V.draws_hex[k]));
  return (n: number) => {
    const b = queue.shift();
    if (!b || b.length !== n) throw new Error(`vector rng: wanted ${n} bytes, had ${b?.length}`);
    return b;
  };
}

const utf8 = (s: string) => new TextEncoder().encode(s);
const PAYLOAD = hex(V.payload_hex);

async function vectorFile() {
  const rng = vectorRng();
  const created = await createKeyBlock(V.password, { rng, iterations: V.iterations });
  const body = await sealBody(created.fmk, PAYLOAD, { rng });
  return { ...created, body, file: encodeContainer(created.block, body) };
}

describe('recovery key (same format as filex E2E)', () => {
  it('prints 20 bytes as 32 Crockford base32 characters in eight groups of four', () => {
    expect(formatRecoveryKey(hex(V.draws_hex.recovery_raw))).toBe(V.recovery_key);
    expect(V.recovery_key).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/);
  });

  it('reads a key back however it was retyped', () => {
    const raw = hex(V.draws_hex.recovery_raw);
    const typed = V.recovery_key.toLowerCase().replace(/-/g, ' ').replace(/0/g, 'O').replace(/1/g, 'l');
    expect(parseRecoveryKey(typed)).toEqual(raw);
  });

  it('refuses a key of the wrong length or with a letter Crockford does not use', () => {
    expect(parseRecoveryKey(V.recovery_key.slice(0, -1))).toBeNull();
    expect(parseRecoveryKey(V.recovery_key.slice(0, -1) + 'U')).toBeNull();
    expect(parseRecoveryKey('')).toBeNull();
  });
});

describe('container: the fixed vector', () => {
  it('builds exactly the bytes the reference implementation built', async () => {
    const { file, block, recoveryKey } = await vectorFile();
    expect(recoveryKey).toBe(V.recovery_key);
    expect(new TextDecoder().decode(decodeContainer(file).headerBytes)).toBe(V.header_json);
    expect(toHex(file)).toBe(V.file_hex);
    expect(sha(file)).toBe(V.file_sha256);
    expect(block.iter).toBe(600_000);
  });

  it('opens the reference file with the password', async () => {
    const { block, body } = decodeContainer(hex(V.file_hex));
    const fmk = await unlock(block, { password: V.password });
    expect(new TextDecoder().decode(await openBody(fmk, body))).toBe(new TextDecoder().decode(PAYLOAD));
  });

  it('opens the reference file with the recovery key', async () => {
    const { block, body } = decodeContainer(hex(V.file_hex));
    const fmk = await unlock(block, { recoveryKey: V.recovery_key });
    expect(await openBody(fmk, body)).toEqual(PAYLOAD);
  });

  it('carries a standard filexe2e v1 blob as its body', () => {
    const { body } = decodeContainer(hex(V.file_hex));
    expect(new TextDecoder().decode(body.slice(0, 8))).toBe('filexe2e');
    expect(body[8]).toBe(1);
    expect(toHex(body)).toBe(V.body_hex);
  });
});

describe('container: refusing what it cannot open', () => {
  it('says "wrong password" for a wrong password and a wrong recovery key', async () => {
    const { block } = decodeContainer(hex(V.file_hex));
    await expect(unlock(block, { password: 'correct horse battery stapl' })).rejects.toMatchObject({ code: 'wrong_credential' });
    const other = formatRecoveryKey(new Uint8Array(20).fill(7));
    await expect(unlock(block, { recoveryKey: other })).rejects.toMatchObject({ code: 'wrong_credential' });
    await expect(unlock(block, { recoveryKey: 'not a key' })).rejects.toMatchObject({ code: 'wrong_credential' });
  });

  it('refuses a file that is not a workspace', () => {
    expect(isFxtxt(utf8('hello world, plain text'))).toBe(false);
    expect(() => decodeContainer(utf8('hello world, plain text'))).toThrow(FxtxtError);
    expect(() => decodeContainer(new Uint8Array())).toThrowError(expect.objectContaining({ code: 'not_fxtxt' }));
  });

  it('refuses a container version it does not know', () => {
    const f = hex(V.file_hex);
    f[8] = 2;
    expect(() => decodeContainer(f)).toThrowError(expect.objectContaining({ code: 'unsupported' }));
  });

  it('refuses a truncated file or a broken key block', () => {
    const f = hex(V.file_hex);
    expect(() => decodeContainer(f.slice(0, 40))).toThrowError(expect.objectContaining({ code: 'damaged' }));
    const g = f.slice();
    g[20] = 0x7b; // inside the JSON
    g[21] = 0x7b;
    expect(() => decodeContainer(g)).toThrowError(expect.objectContaining({ code: 'damaged' }));
    const len = f.slice();
    len[9] = 0xff; // header length far past the end
    expect(() => decodeContainer(len)).toThrowError(expect.objectContaining({ code: 'damaged' }));
  });

  it('refuses a key block that asks for an absurd number of iterations', () => {
    const { block, body } = decodeContainer(hex(V.file_hex));
    const bad = encodeContainer({ ...block, iter: 2_000_000_000 }, body);
    expect(() => decodeContainer(bad)).toThrowError(expect.objectContaining({ code: 'damaged' }));
  });

  it('notices a flipped byte in the content, in the wrapped key and in the key slots', async () => {
    const { block, body } = decodeContainer(hex(V.file_hex));
    const fmk = await unlock(block, { password: V.password });
    const content = body.slice();
    content[content.length - 3] ^= 1;
    await expect(openBody(fmk, content)).rejects.toMatchObject({ code: 'damaged' });
    const wrapped = body.slice();
    wrapped[30] ^= 1;
    await expect(openBody(fmk, wrapped)).rejects.toMatchObject({ code: 'damaged' });
    const slot = { ...block, fmk_pw: block.fmk_pw.slice(0, 20) + (block.fmk_pw[20] === 'A' ? 'B' : 'A') + block.fmk_pw.slice(21) };
    await expect(unlock(slot, { password: V.password })).rejects.toMatchObject({ code: 'wrong_credential' });
  });
});

describe('saving', () => {
  it('uses a fresh key and fresh nonces on every save', async () => {
    const { fmk } = await vectorFile();
    const a = await sealBody(fmk, PAYLOAD);
    const b = await sealBody(fmk, PAYLOAD);
    expect(toHex(a.slice(9, 21))).not.toBe(toHex(b.slice(9, 21))); // wrap IV
    expect(toHex(a.slice(21, 69))).not.toBe(toHex(b.slice(21, 69))); // wrapped DEK
    expect(toHex(a.slice(69, 81))).not.toBe(toHex(b.slice(69, 81))); // data IV
    expect(await openBody(fmk, a)).toEqual(PAYLOAD);
    expect(await openBody(fmk, b)).toEqual(PAYLOAD);
  });

  it('never writes the payload in the clear', async () => {
    const { fmk, block } = await vectorFile();
    const secret = utf8('TOP-SECRET-MARKER-' + 'x'.repeat(40));
    const file = encodeContainer(block, await sealBody(fmk, secret));
    expect(Buffer.from(file).includes(Buffer.from('TOP-SECRET-MARKER'))).toBe(false);
  });
});

/** Hands out the re-key vector's draws in its documented order. */
function rekeyRng() {
  const R = V.rekey;
  const queue = (R.draw_order as string[]).map((k) => hex(R.draws_hex[k]));
  return (n: number) => {
    const b = queue.shift();
    if (!b || b.length !== n) throw new Error(`rekey rng: wanted ${n} bytes, had ${b?.length}`);
    return b;
  };
}

/** Change the password the way the app does: re-key, then re-encrypt. */
async function rekeyFile(file: Uint8Array, cred: Parameters<typeof rekey>[1], newPassword: string, rng?: (n: number) => Uint8Array) {
  const { block, body } = decodeContainer(file);
  const oldFmk = await unlock(block, cred);
  const next = await rekey(block, cred, newPassword, rng ? { rng } : {});
  const payload = await openBody(oldFmk, body);
  return { ...next, oldFmk, file: encodeContainer(next.block, await sealBody(next.fmk, payload, rng ? { rng } : {})) };
}

describe('changing the password re-keys the file', () => {
  it('builds exactly the reference re-key vector (recovery key as the proof)', async () => {
    const R = V.rekey;
    const out = await rekeyFile(hex(V.file_hex), { recoveryKey: V.recovery_key }, R.new_password, rekeyRng());
    expect(out.recoveryKey).toBe(R.recovery_key);
    expect(new TextDecoder().decode(decodeContainer(out.file).headerBytes)).toBe(R.header_json);
    expect(toHex(out.file)).toBe(R.file_hex);
    expect(sha(out.file)).toBe(R.file_sha256);
  });

  it('nothing old opens the new file: not the password, not the recovery key, not the old master key', async () => {
    const R = V.rekey;
    const { block, body } = decodeContainer(hex(R.file_hex));
    await expect(unlock(block, { password: V.password })).rejects.toMatchObject({ code: 'wrong_credential' });
    await expect(unlock(block, { recoveryKey: V.recovery_key })).rejects.toMatchObject({ code: 'wrong_credential' });
    const old = await unlock(decodeContainer(hex(V.file_hex)).block, { password: V.password });
    await expect(openBody(old, body)).rejects.toMatchObject({ code: 'damaged' });
    // The new password and the NEW recovery key both open it.
    expect(await openBody(await unlock(block, { password: R.new_password }), body)).toEqual(PAYLOAD);
    expect(await openBody(await unlock(block, { recoveryKey: R.recovery_key }), body)).toEqual(PAYLOAD);
  });

  it('with the current password as the proof: a new key, a new recovery key, the old one refused', async () => {
    const out = await rekeyFile(hex(V.file_hex), { password: V.password }, 'second password!');
    expect(out.recoveryKey).not.toBe(V.recovery_key);
    const { block, body } = decodeContainer(out.file);
    await expect(unlock(block, { password: V.password })).rejects.toMatchObject({ code: 'wrong_credential' });
    await expect(unlock(block, { recoveryKey: V.recovery_key })).rejects.toMatchObject({ code: 'wrong_credential' });
    await expect(openBody(out.oldFmk, body)).rejects.toMatchObject({ code: 'damaged' });
    expect(await openBody(await unlock(block, { password: 'second password!' }), body)).toEqual(PAYLOAD);
    expect(await openBody(await unlock(block, { recoveryKey: out.recoveryKey }), body)).toEqual(PAYLOAD);
    // The copy made before the change still opens with what it was made with.
    const before = decodeContainer(hex(V.file_hex));
    expect(await openBody(await unlock(before.block, { password: V.password }), before.body)).toEqual(PAYLOAD);
  });

  it('refuses a wrong proof and a new password that is too short', async () => {
    const { block } = decodeContainer(hex(V.file_hex));
    await expect(rekey(block, { password: 'nope nope nope' }, 'whatever12345')).rejects.toMatchObject({ code: 'wrong_credential' });
    await expect(rekey(block, { recoveryKey: formatRecoveryKey(new Uint8Array(20).fill(9)) }, 'whatever12345')).rejects.toMatchObject({
      code: 'wrong_credential',
    });
    await expect(rekey(block, { password: V.password }, 'x'.repeat(MIN_PASSWORD_LEN - 1))).rejects.toMatchObject({ code: 'weak_password' });
  });

  it('a new workspace refuses a short password and mints a recovery key', async () => {
    await expect(createKeyBlock('short')).rejects.toMatchObject({ code: 'weak_password' });
    const made = await createKeyBlock('long enough password');
    expect(made.recoveryKey).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(made.block.iter).toBe(600_000);
    const body = await sealBody(made.fmk, PAYLOAD);
    const file = decodeContainer(encodeContainer(made.block, body));
    expect(await openBody(await unlock(file.block, { recoveryKey: made.recoveryKey }), file.body)).toEqual(PAYLOAD);
  });
});
