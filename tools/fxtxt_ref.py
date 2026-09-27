#!/usr/bin/env python3
"""Reference implementation of the .fxtxt container (docs/FORMAT.md).

Independent of the app's TypeScript: it exists so the format is checked by a
second implementation, and so a .fxtxt can be opened without a browser.

    python tools/fxtxt_ref.py decrypt notes.fxtxt -o notes.zip           # asks for the password
    python tools/fxtxt_ref.py decrypt notes.fxtxt --recovery-key -o x.zip
    python tools/fxtxt_ref.py vectors tests/vectors/container-v1.json   # regenerate the test vectors

Needs the `cryptography` package (AES-GCM). Standard library otherwise.
"""
from __future__ import annotations

import argparse
import base64
import getpass
import hashlib
import hmac
import json
import struct
import sys
from typing import Callable, Optional

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

MAGIC = b"filextxt"
CONTAINER_VERSION = 1
E2E_MAGIC = b"filexe2e"
E2E_FILE_VERSION = 1
E2E_HEADER_LEN = 97
VERIFY_PLAINTEXT = b"filex-e2e-verify-v1"
RK_INFO = b"filex-e2e-recovery-v1"
B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
MAX_ITERATIONS = 100_000_000
MAX_HEADER = 64 * 1024


class FxtxtError(Exception):
    pass


def b64(b: bytes) -> str:
    return base64.b64encode(b).decode("ascii")


def unb64(s: str) -> bytes:
    return base64.b64decode(s, validate=True)


# ── recovery key ────────────────────────────────────────────────────────────

def format_recovery_key(raw: bytes) -> str:
    bits = 0
    acc = 0
    out = []
    for byte in raw:
        acc = (acc << 8) | byte
        bits += 8
        while bits >= 5:
            out.append(B32[(acc >> (bits - 5)) & 31])
            bits -= 5
    if bits:
        out.append(B32[(acc << (5 - bits)) & 31])
    s = "".join(out)
    return "-".join(s[i:i + 4] for i in range(0, len(s), 4))


def parse_recovery_key(s: str) -> Optional[bytes]:
    clean = s.upper().replace("-", "").replace(" ", "").replace("\t", "").replace("\n", "")
    clean = clean.replace("O", "0").replace("I", "1").replace("L", "1")
    if len(clean) != 32:
        return None
    acc = 0
    bits = 0
    out = bytearray()
    for ch in clean:
        v = B32.find(ch)
        if v < 0:
            return None
        acc = (acc << 5) | v
        bits += 5
        if bits >= 8:
            out.append((acc >> (bits - 8)) & 0xFF)
            bits -= 8
    return bytes(out) if len(out) == 20 else None


# ── key derivation ──────────────────────────────────────────────────────────

def derive_kek(password: str, salt: bytes, iterations: int) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations, 32)


def hkdf_sha256(ikm: bytes, salt: bytes, info: bytes, length: int = 32) -> bytes:
    prk = hmac.new(salt, ikm, hashlib.sha256).digest()
    okm = b""
    block = b""
    counter = 1
    while len(okm) < length:
        block = hmac.new(prk, block + info + bytes([counter]), hashlib.sha256).digest()
        okm += block
        counter += 1
    return okm[:length]


def derive_rkek(raw: bytes, salt: bytes) -> bytes:
    return hkdf_sha256(raw, salt, RK_INFO)


def gcm_seal(key: bytes, iv: bytes, plain: bytes) -> str:
    return b64(iv + AESGCM(key).encrypt(iv, plain, None))


def gcm_open(key: bytes, blob: str) -> Optional[bytes]:
    try:
        raw = unb64(blob)
    except Exception:
        return None
    if len(raw) <= 12:
        return None
    try:
        return AESGCM(key).decrypt(raw[:12], raw[12:], None)
    except Exception:
        return None


# ── container ───────────────────────────────────────────────────────────────

def key_block(password: str, rng: Callable[[int], bytes], iterations: int = 600_000) -> tuple[dict, bytes, str]:
    """A new key block. Random draws, in this order: FMK 32, salt 16, verify
    IV 12, fmk_pw IV 12, recovery key 20, recovery salt 16, recovery IV 12."""
    fmk = rng(32)
    salt = rng(16)
    kek = derive_kek(password, salt, iterations)
    verify = gcm_seal(kek, rng(12), VERIFY_PLAINTEXT)
    fmk_pw = gcm_seal(kek, rng(12), fmk)
    rk_raw = rng(20)
    rk_salt = rng(16)
    rk_blob = gcm_seal(derive_rkek(rk_raw, rk_salt), rng(12), fmk)
    block = {
        "v": 2,
        "salt": b64(salt),
        "iter": iterations,
        "verify": verify,
        "fmk": "wrapped",
        "fmk_pw": fmk_pw,
        "rk": {"salt": b64(rk_salt), "blob": rk_blob},
    }
    return block, fmk, format_recovery_key(rk_raw)


def encrypt_body(fmk: bytes, payload: bytes, rng: Callable[[int], bytes]) -> bytes:
    """A filexe2e v1 blob. Random draws: DEK 32, wrap IV 12, data IV 12."""
    dek = rng(32)
    wrap_iv = rng(12)
    data_iv = rng(12)
    wrapped = AESGCM(fmk).encrypt(wrap_iv, dek, None)
    ct = AESGCM(dek).encrypt(data_iv, payload, None)
    return E2E_MAGIC + bytes([E2E_FILE_VERSION]) + wrap_iv + wrapped + data_iv + bytes(16) + ct


def decrypt_body(fmk: bytes, body: bytes) -> bytes:
    if len(body) < E2E_HEADER_LEN + 16 or body[:8] != E2E_MAGIC:
        raise FxtxtError("damaged: the encrypted body is not a filexe2e blob")
    if body[8] != E2E_FILE_VERSION:
        raise FxtxtError(f"unsupported body version {body[8]}")
    try:
        dek = AESGCM(fmk).decrypt(body[9:21], body[21:69], None)
        return AESGCM(dek).decrypt(body[69:81], body[97:], None)
    except Exception as e:
        raise FxtxtError("damaged: the content does not decrypt") from e


def header_json(block: dict) -> bytes:
    return json.dumps(block, separators=(",", ":"), ensure_ascii=True).encode("utf-8")


def encode_container(block: dict, body: bytes) -> bytes:
    h = header_json(block)
    return MAGIC + bytes([CONTAINER_VERSION]) + struct.pack(">I", len(h)) + h + body


def decode_container(data: bytes) -> tuple[dict, bytes]:
    if len(data) < 13 or data[:8] != MAGIC:
        raise FxtxtError("not a .fxtxt workspace")
    if data[8] != CONTAINER_VERSION:
        raise FxtxtError(f"unsupported container version {data[8]}")
    (n,) = struct.unpack(">I", data[9:13])
    if n == 0 or n > MAX_HEADER or 13 + n > len(data):
        raise FxtxtError("damaged: bad key block length")
    block = json.loads(data[13:13 + n].decode("utf-8"))
    if block.get("v") != 2 or block.get("fmk") != "wrapped":
        raise FxtxtError("damaged: unknown key block")
    it = block.get("iter")
    if not isinstance(it, int) or it < 1 or it > MAX_ITERATIONS:
        raise FxtxtError("damaged: bad iteration count")
    return block, data[13 + n:]


def unlock_password(block: dict, password: str) -> Optional[bytes]:
    kek = derive_kek(password, unb64(block["salt"]), block["iter"])
    if gcm_open(kek, block["verify"]) != VERIFY_PLAINTEXT:
        return None
    fmk = gcm_open(kek, block["fmk_pw"])
    return fmk if fmk and len(fmk) == 32 else None


def unlock_recovery(block: dict, key: str) -> Optional[bytes]:
    raw = parse_recovery_key(key)
    rk = block.get("rk")
    if raw is None or not rk:
        return None
    fmk = gcm_open(derive_rkek(raw, unb64(rk["salt"])), rk["blob"])
    return fmk if fmk and len(fmk) == 32 else None


# ── test vectors ────────────────────────────────────────────────────────────

def fixed_rng(chunks: list[bytes]) -> Callable[[int], bytes]:
    queue = list(chunks)

    def rng(n: int) -> bytes:
        b = queue.pop(0)
        assert len(b) == n, (n, len(b))
        return b

    return rng


def seq(start: int, n: int) -> bytes:
    return bytes((start + i) & 0xFF for i in range(n))


def rekey(block: dict, credential: dict, new_password: str, rng: Callable[[int], bytes],
          iterations: int = 600_000) -> tuple[dict, bytes, str]:
    """A password change. The credential (`{"password": …}` or
    `{"recovery_key": …}`) must open the current block; the result is a whole
    new key block — new FMK, new password slot, new recovery key — and the
    caller re-encrypts the body under the new FMK. Random draws: as key_block."""
    if "password" in credential:
        ok = unlock_password(block, credential["password"])
    else:
        ok = unlock_recovery(block, credential["recovery_key"])
    if ok is None:
        raise FxtxtError("wrong password or recovery key")
    return key_block(new_password, rng, iterations)


def rekey_vector(old_file: bytes, old_recovery_key: str, payload: bytes) -> dict:
    new_password = "yeni parola — ŞİFRE 2026"
    draws = {
        "fmk": seq(0x30, 32),
        "salt": seq(0x10, 16),
        "verify_iv": seq(0xA4, 12),
        "fmk_pw_iv": seq(0xB4, 12),
        "recovery_raw": seq(0x50, 20),
        "recovery_salt": seq(0x70, 16),
        "recovery_iv": seq(0xC4, 12),
        "dek": seq(0x90, 32),
        "wrap_iv": seq(0xD4, 12),
        "data_iv": seq(0xE4, 12),
    }
    order = ["fmk", "salt", "verify_iv", "fmk_pw_iv", "recovery_raw", "recovery_salt", "recovery_iv",
             "dek", "wrap_iv", "data_iv"]
    old_block, old_body = decode_container(old_file)
    rng = fixed_rng([draws[k] for k in order])
    block, fmk, rk = rekey(old_block, {"recovery_key": old_recovery_key}, new_password, rng)
    old_fmk = unlock_recovery(old_block, old_recovery_key)
    data = encode_container(block, encrypt_body(fmk, decrypt_body(old_fmk, old_body), rng))
    b2, body2 = decode_container(data)
    assert unlock_password(b2, new_password) == fmk
    assert unlock_recovery(b2, rk) == fmk
    assert decrypt_body(fmk, body2) == payload
    # Nothing old opens the new file: not the old password, not the old
    # recovery key, not the old FMK.
    assert unlock_password(b2, "correct horse battery staple") is None
    assert unlock_recovery(b2, old_recovery_key) is None
    try:
        decrypt_body(old_fmk, body2)
        raise AssertionError("the old FMK opened the re-keyed body")
    except FxtxtError:
        pass
    return {
        "credential": "recovery_key",
        "new_password": new_password,
        "draws_hex": {k: v.hex() for k, v in draws.items()},
        "draw_order": order,
        "recovery_key": rk,
        "header_json": header_json(block).decode("ascii"),
        "file_hex": data.hex(),
        "file_sha256": hashlib.sha256(data).hexdigest(),
    }


def vectors() -> dict:
    password = "correct horse battery staple"
    iterations = 600_000
    draws = {
        "fmk": seq(0x20, 32),
        "salt": seq(0x00, 16),
        "verify_iv": seq(0xA0, 12),
        "fmk_pw_iv": seq(0xB0, 12),
        "recovery_raw": seq(0x40, 20),
        "recovery_salt": seq(0x60, 16),
        "recovery_iv": seq(0xC0, 12),
        "dek": seq(0x80, 32),
        "wrap_iv": seq(0xD0, 12),
        "data_iv": seq(0xE0, 12),
    }
    payload = "Merhaba dünya — fxtxt test vector.\n".encode("utf-8")
    rng = fixed_rng([draws[k] for k in (
        "fmk", "salt", "verify_iv", "fmk_pw_iv", "recovery_raw", "recovery_salt", "recovery_iv",
        "dek", "wrap_iv", "data_iv")])
    block, fmk, rk = key_block(password, rng, iterations)
    body = encrypt_body(fmk, payload, rng)
    data = encode_container(block, body)
    # Self-check with the reader half.
    b2, body2 = decode_container(data)
    assert unlock_password(b2, password) == fmk
    assert unlock_recovery(b2, rk) == fmk
    assert decrypt_body(fmk, body2) == payload
    return {
        "note": "Generated by tools/fxtxt_ref.py (Python, independent of the app). See docs/FORMAT.md.",
        "rekey": rekey_vector(data, rk, payload),
        "password": password,
        "iterations": iterations,
        "draws_hex": {k: v.hex() for k, v in draws.items()},
        "draw_order": ["fmk", "salt", "verify_iv", "fmk_pw_iv", "recovery_raw", "recovery_salt",
                       "recovery_iv", "dek", "wrap_iv", "data_iv"],
        "payload_hex": payload.hex(),
        "recovery_key": rk,
        "kek_hex": derive_kek(password, draws["salt"], iterations).hex(),
        "rkek_hex": derive_rkek(draws["recovery_raw"], draws["recovery_salt"]).hex(),
        "header_json": header_json(block).decode("ascii"),
        "body_hex": body.hex(),
        "file_hex": data.hex(),
        "file_sha256": hashlib.sha256(data).hexdigest(),
    }


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("decrypt", help="decrypt a .fxtxt to its payload (a zip)")
    d.add_argument("file")
    d.add_argument("-o", "--out", required=True)
    d.add_argument("--recovery-key", action="store_true", help="ask for the recovery key instead of the password")
    d.add_argument("--stdin", action="store_true", help="read the password (or key) from the first line of stdin")
    v = sub.add_parser("vectors", help="write the test vectors")
    v.add_argument("out")
    a = ap.parse_args(argv)
    if a.cmd == "vectors":
        with open(a.out, "w", encoding="utf-8", newline="\n") as f:
            json.dump(vectors(), f, indent=2, ensure_ascii=False)
            f.write("\n")
        return 0
    with open(a.file, "rb") as f:
        data = f.read()
    block, body = decode_container(data)
    if a.stdin:
        # Bytes, decoded as UTF-8 whatever the console's code page says.
        secret = sys.stdin.buffer.readline().decode("utf-8").rstrip("\r\n")
    else:
        secret = getpass.getpass("Recovery key: " if a.recovery_key else "Password: ")
    fmk = unlock_recovery(block, secret) if a.recovery_key else unlock_password(block, secret)
    if fmk is None:
        print("wrong password or recovery key", file=sys.stderr)
        return 2
    with open(a.out, "wb") as f:
        f.write(decrypt_body(fmk, body))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
