# The `.fxtxt` file format, version 1

A `.fxtxt` file is one end-to-end encrypted text workspace: pages, folders
and images, edited with AFFiNE's BlockSuite editor. Everything in it is
encrypted in the browser; the server that stores it (filex) holds ciphertext
and nothing that can open it.

The format reuses filex's end-to-end encryption exactly
([filex docs/E2E-ENCRYPTION.md](https://github.com/BRF-Tech/filex/blob/main/docs/E2E-ENCRYPTION.md)):
the key block **is** a filex encrypted-folder marker (`.filex-e2e.json`,
version 2) and the body **is** a filex encrypted file (`filexe2e`, version 1).
A `.fxtxt` is those two things in one file, behind a 13-byte prefix. Anything
that opens a filex encrypted folder can open a `.fxtxt` with that framing
added.

- [Layout](#layout)
- [Key hierarchy](#key-hierarchy)
- [Key block](#key-block)
- [Body](#body)
- [Recovery key](#recovery-key)
- [Opening, saving, changing the password](#opening-saving-changing-the-password)
- [Payload](#payload)
- [Limits and refusals](#limits-and-refusals)
- [What it does not protect](#what-it-does-not-protect)
- [Test vectors](#test-vectors)
- [Reference implementations](#reference-implementations)

---

## Layout

| Offset | Size | Field |
|---|---|---|
| 0 | 8 | Magic: ASCII `filextxt` (`66 69 6c 65 78 74 78 74`) |
| 8 | 1 | Container version: `0x01` |
| 9 | 4 | `H`, the key block's length in bytes, unsigned 32-bit **big-endian** |
| 13 | H | Key block: UTF-8 JSON ([below](#key-block)) |
| 13 + H | rest | Body: a `filexe2e` v1 blob ([below](#body)) |

A reader refuses a file that does not start with the magic (`not_fxtxt`), a
container version it does not know (`unsupported`), and a length of 0, over
64 KiB, or running past the end of the file (`damaged`).

## Key hierarchy

The same as filex's:

```
password ─PBKDF2-SHA256(iterations, 16-byte salt)──▶ KEK  ─┐
recovery key ─HKDF-SHA256(16-byte salt, info)──────▶ RKEK ─┴─▶ unwrap the FMK
                                                                  │
a fresh 32-byte DEK per save, AES-256-GCM-wrapped by the FMK ◀────┘
the payload, AES-256-GCM-encrypted by the DEK
```

- **FMK** (file master key): 32 random bytes, made when the workspace is
  created and made again on every password change ([below](#changing-the-password)).
  Never stored in the clear.
- **KEK**: `PBKDF2(HMAC-SHA256, password as UTF-8, salt, iterations, 32 bytes)`.
  New key blocks use **600,000** iterations.
- **RKEK**: `HKDF-SHA256(ikm = the recovery key's 20 bytes, salt, info =
  "filex-e2e-recovery-v1", 32 bytes)` - filex's info string, unchanged.
- **DEK**: 32 random bytes, new on **every save**, with new IVs.
- Every AES-GCM operation uses a 12-byte random IV and a 16-byte tag, no
  associated data.

## Key block

UTF-8 JSON, the fields of a filex marker v2 with `fmk: "wrapped"`, written in
this order and without whitespace:

```json
{
  "v": 2,
  "salt": "<base64, 16 bytes: the PBKDF2 salt>",
  "iter": 600000,
  "verify": "<base64: 12-byte IV ‖ AES-GCM(KEK, \"filex-e2e-verify-v1\")>",
  "fmk": "wrapped",
  "fmk_pw": "<base64: 12-byte IV ‖ AES-GCM(KEK, FMK)>",
  "rk": { "salt": "<base64, 16 bytes: the HKDF salt>", "blob": "<base64: 12-byte IV ‖ AES-GCM(RKEK, FMK)>" }
}
```

| Field | Meaning |
|---|---|
| `v` | Always `2` (filex marker schema 2). Anything else: `damaged`. |
| `salt`, `iter`, `verify` | The password slot's recipe. A wrong password fails the GCM tag on `verify`, so it is recognised locally, with no second key tried. |
| `fmk` | Always `"wrapped"`: the FMK is random and lives in `fmk_pw`. (filex's `"kek"` form, for folders upgraded from v1, never occurs in a `.fxtxt`.) |
| `fmk_pw` | The FMK under the password's KEK. |
| `rk` | The FMK under the recovery key's RKEK. Written by every version of this app; a reader treats it as optional. |

Nothing in the key block is secret: every slot is the same 32 bytes sealed
under a key the file does not contain. Standard base64 with padding. Readers
accept `iter` from 1 to 100,000,000 (filex's bound) and derive with the value
the block states; writers never write less than 600,000.

A key block has no escrow slot (`esc`) and no required features (`req`,
filex marker v3): a `.fxtxt` is personal, and it never contains names in the
clear to hide.

## Body

Byte for byte a filex encrypted file, version 1:

| Offset | Size | Field |
|---|---|---|
| 0 | 8 | ASCII `filexe2e` |
| 8 | 1 | `0x01` |
| 9 | 12 | `wrapIV` |
| 21 | 48 | `AES-GCM(FMK, wrapIV, DEK)` (32 bytes + tag) |
| 69 | 12 | `dataIV` |
| 81 | 16 | Reserved, zeros |
| 97 | n + 16 | `AES-GCM(DEK, dataIV, payload)` |

The payload is at most 200 MiB (filex's one-shot limit).

## Recovery key

20 random bytes (160 bits), written as 32 characters of Crockford base32
(`0123456789ABCDEFGHJKMNPQRSTVWXYZ`), in eight groups of four joined by `-`:
`XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX`. Bits are taken most significant
first. Reading it back ignores case, spaces and dashes and maps the
look-alikes `O`→`0`, `I`/`L`→`1`. It is filex's recovery key format exactly.

The key is shown once, when the workspace is created, and is not stored
anywhere - not in the file, not in the browser, not by filex.

## Opening, saving, changing the password

- **Create.** An empty file opened with the app becomes a workspace: the
  person picks a password (at least 8 characters), the app makes the FMK, the
  password slot and the recovery slot, **saves the file at once** (so the key
  about to be shown opens what is stored), then shows the recovery key and
  waits for "I have saved it".
- **Open with the password.** KEK → check `verify` → unwrap `fmk_pw` → FMK →
  decrypt the body.
- **Open with the recovery key.** RKEK → unwrap `rk.blob` → FMK → decrypt.
  The app then **requires a new password** before the workspace opens, and a
  new password is a re-key ([below](#changing-the-password)): the person gets
  a **new recovery key**, shown once, and the old one stops opening the file.
- **Save.** A fresh DEK and fresh IVs every time; the key block is written
  unchanged.
- <a id="changing-the-password"></a>**Change the password = re-key.** At any
  time, with the current password **or** the recovery key as proof (checked
  against the current key block, then forgotten), the writer makes a **whole
  new key block** exactly as for a new workspace - a new FMK, a new password
  slot, a **new recovery key** - decrypts the payload with the old FMK,
  encrypts it under the new one (a new DEK and new IVs, as on every save),
  **saves**, and only then shows the new recovery key, once.

  So nothing old opens what is saved from the change on: not the old
  password, not the old recovery key, not the old FMK - including for someone
  who knew them and holds an earlier version of the file (filex keeps
  versions). What cannot change is arithmetic: a copy saved **before** the
  change still opens with the password and key it was saved with.

  This differs on purpose from filex's encrypted folders, where a password
  change re-wraps the same FMK (many files; a re-key there means re-wrapping
  every file's DEK). A `.fxtxt` is one file, so a re-key costs one
  re-encryption. The format itself is unchanged: a re-keyed file is an
  ordinary version-1 file whose key block happens to be new.

## Payload

The plaintext the body encrypts is a zip archive (deflate), so a decrypted
workspace opens with any unzip tool:

| Path | Content |
|---|---|
| `fxtxt.json` | The manifest ([below](#manifest)) |
| `ydoc/root.bin` | Yjs update of the workspace root: BlockSuite's page list (`meta.pages`) and the folder tree (map `fxtxt:folders`) |
| `ydoc/<n>.bin` | Yjs update of one page (BlockSuite `affine:page` → `affine:note` → blocks) - **authoritative** |
| `pages/<folder>/…/<title>.md` | The same page as Markdown - for people and tools; the app never reads it |
| `blobs/<n>` | An image, raw bytes |

### Manifest

```json
{
  "format": "fxtxt-payload",
  "v": 1,
  "editor": "blocksuite/0.27.0",
  "saved": "2026-09-27T04:00:00.000Z",
  "root": "ydoc/root.bin",
  "pages": [{ "id": "<page id>", "title": "Toplantı notları", "ydoc": "ydoc/1.bin", "md": "pages/Proje/Toplantı notları.md" }],
  "folders": [{ "id": "<row id>", "parentId": null, "type": "folder", "data": "Proje", "index": "i" },
              { "id": "<row id>", "parentId": "<folder row id>", "type": "doc", "data": "<page id>", "index": "i" }],
  "blobs": [{ "key": "<the key image blocks reference>", "type": "image/png", "path": "blobs/1" }]
}
```

- `pages[].md` is absent when the Markdown copy could not be made; the page
  is still complete in its Yjs update.
- `folders` rows have AFFiNE's "Organize" folder shape: a folder carries its
  name in `data`, a doc row the page id. `parentId` null is the top level;
  `index` sorts siblings as plain strings. A page without a row sits at the
  top level. The same rows live in `ydoc/root.bin`; this copy is for readers
  without Yjs.
- Markdown paths: folder names and page titles with `\ / : * ? " < > |` and
  control characters replaced by `_`, Windows device names suffixed with `_`,
  at most 120 characters a segment, duplicates numbered ` (2)`, ` (3)`… A
  path never contains `..`.
- A reader refuses a manifest whose `format` is not `fxtxt-payload`
  (`damaged`) or whose `v` is newer than it knows (`unsupported`), a listed
  file that is missing (`damaged`), and an archive over 20,000 entries,
  256 MiB for one entry or 512 MiB in total (`too_large`).

## Limits and refusals

| Code | When |
|---|---|
| `not_fxtxt` | No `filextxt` magic |
| `unsupported` | A container version, body version or payload version newer than the reader |
| `damaged` | A bad length, key block JSON, missing field, iteration count out of range, a body that does not decrypt, a payload that is not the zip above |
| `wrong_credential` | The password or recovery key does not open the key block |
| `weak_password` | A new password under 8 characters |
| `too_large` | A payload over 200 MiB (write), or an archive over the limits above (read) |

## What it does not protect

- **Size.** The file's size tracks the workspace's size (compressed).
- **When.** filex sees when the file is saved and by whom.
- **The browser.** Keys and plaintext live in the memory of the open tab, in
  a sandboxed frame; code that runs in that frame can read them. filex serves
  that code - the usual limit of web end-to-end encryption.
- **Old versions and old passwords.** See [changing the password](#changing-the-password).
- **A lost password and a lost recovery key.** Nobody can open the file.

## Test vectors

Produced by the Python reference (`tools/fxtxt_ref.py vectors`), checked by
the TypeScript tests (`tests/fxtxt.test.ts`) byte for byte, and opened by
filex's own Go decryptor (`backend/internal/e2edecrypt`, unmodified). The
full vector is `tests/vectors/container-v1.json`; it holds a second vector,
`rekey`, for a password change (below).

Inputs:

| | |
|---|---|
| password | `correct horse battery staple` |
| iterations | 600000 |
| payload (UTF-8) | `Merhaba dünya — fxtxt test vector.\n` |

Random draws, in the order a writer takes them:

| Draw | Bytes (hex) |
|---|---|
| FMK (32) | `202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f` |
| salt (16) | `000102030405060708090a0b0c0d0e0f` |
| verify IV (12) | `a0a1a2a3a4a5a6a7a8a9aaab` |
| fmk_pw IV (12) | `b0b1b2b3b4b5b6b7b8b9babb` |
| recovery key (20) | `404142434445464748494a4b4c4d4e4f50515253` |
| recovery salt (16) | `606162636465666768696a6b6c6d6e6f` |
| recovery IV (12) | `c0c1c2c3c4c5c6c7c8c9cacb` |
| DEK (32) | `808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f` |
| wrap IV (12) | `d0d1d2d3d4d5d6d7d8d9dadb` |
| data IV (12) | `e0e1e2e3e4e5e6e7e8e9eaeb` |

Outputs:

| | |
|---|---|
| recovery key | `810M-4GT4-8N34-EJ29-995M-RKAE-9X85-2MJK` |
| KEK | `ef177144eec9420cbc1093d2a8b344a92bc506d0d4ec9c028dd19f8324d8c1e6` |
| RKEK | `b9e39104338969574d69c91c3f058fc2cb79a42da704ac31ec7289c8c35d509e` |
| file length | 534 bytes |
| file SHA-256 | `906410475a6183086f558d9070021ca7eb66de5cd328b1d5ac28bbb3294c1749` |

Key block (the exact 370 bytes after the prefix):

```json
{"v":2,"salt":"AAECAwQFBgcICQoLDA0ODw==","iter":600000,"verify":"oKGio6SlpqeoqaqrzQff5QMYoNpSB2TXdvxrytUo3s25LL+PQy69NhzYKW9pr5s=","fmk":"wrapped","fmk_pw":"sLGys7S1tre4ubq7ywXrjZtCW/gGFABouOMhvHpeExyumyQuSCDqZvPpHB4JU2QnrvyiV7WpT6Y4G0NP","rk":{"salt":"YGFiY2RlZmdoaWprbG1ubw==","blob":"wMHCw8TFxsfIycrL+oRSPSLKiALcJGEwD5xIIeIFpuVF/cijPaUbUQh5hBa6gmOMPWLg4n1Nfd25b7kN"}}
```

Body (151 bytes, hex):

```
66696c657865326501d0d1d2d3d4d5d6d7d8d9dadb7ce85eed54761d0394f34cf6c0ea20
08e862c957a6bb4f626fb83ff8ff541737a8c118e8fa15c7e702142af167ed43d1e0e1e2
e3e4e5e6e7e8e9eaeb000000000000000000000000000000006263638f4b91abe796a7fb
33ef72214435a355bd8a333ddc74572839f9ea3aa0ffc1a97bb74119523e442d90fcce40
5ffe1352e387b6
```

### Re-key vector (a password change)

The file above, re-keyed with its **recovery key** as the proof and the new
password `yeni parola — ŞİFRE 2026`. Draws, in the same order as a new workspace:

| Draw | Bytes (hex) |
|---|---|
| FMK (32) | `303132333435363738393a3b3c3d3e3f404142434445464748494a4b4c4d4e4f` |
| salt (16) | `101112131415161718191a1b1c1d1e1f` |
| verify IV (12) | `a4a5a6a7a8a9aaabacadaeaf` |
| fmk_pw IV (12) | `b4b5b6b7b8b9babbbcbdbebf` |
| recovery key (20) | `505152535455565758595a5b5c5d5e5f60616263` |
| recovery salt (16) | `707172737475767778797a7b7c7d7e7f` |
| recovery IV (12) | `c4c5c6c7c8c9cacbcccdcecf` |
| DEK (32) | `909192939495969798999a9b9c9d9e9fa0a1a2a3a4a5a6a7a8a9aaabacadaeaf` |
| wrap IV (12) | `d4d5d6d7d8d9dadbdcdddedf` |
| data IV (12) | `e4e5e6e7e8e9eaebecedeeef` |

| | |
|---|---|
| new recovery key | `A18N-4MTM-ANB5-EP2S-B9DN-RQAY-BXG6-2RK3` |
| file length | 534 bytes |
| file SHA-256 | `1b9f7bbaf69f0d7127fff6525de1ea84568a92f81510f7af7797c7ee9e32b553` |

The re-keyed file opens with the new password and the new recovery key, and
**not** with the old password, the old recovery key or the old FMK - checked
in all three implementations.

Key block:

```json
{"v":2,"salt":"EBESExQVFhcYGRobHB0eHw==","iter":600000,"verify":"pKWmp6ipqqusra6vePu/d9XdKsyYbj5CXXoEv0QWyqCRsjYm4KE0c61125L2cXs=","fmk":"wrapped","fmk_pw":"tLW2t7i5uru8vb6/qjBGKLRU/e2LxlxKsbvIonrHd/GeIESArQbzZWGr1JOR7nYU4eN+ytQsBIW23nKd","rk":{"salt":"cHFyc3R1dnd4eXp7fH1+fw==","blob":"xMXGx8jJysvMzc7PO8LfdkBjEtzvSA1MKQqiL6pBzbTvYuw7SJeFvL40vqzzlMp4yu4uXhIF1/145wCm"}}
```

## Reference implementations

- **TypeScript** (the app): `src/crypto/keys.ts`, `src/crypto/fxtxt.ts`,
  `src/model/payload.ts`.
- **Python** (independent, for checking and for opening a file without a
  browser): `tools/fxtxt_ref.py decrypt notes.fxtxt -o notes.zip`.
- **Go**: filex's `backend/internal/e2edecrypt` opens the key block with
  `ParseMarker` and the body with `DecryptContent` as they are; `filex
  decrypt` needs only the 13-byte framing to read a `.fxtxt`.
