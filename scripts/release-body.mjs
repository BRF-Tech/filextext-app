#!/usr/bin/env node
// The body of a GitHub release: the CHANGELOG.md section of that version.
//
//   node scripts/release-body.mjs 0.1.1 > release/release-notes.md
//
// ⚠ Why (filex task #122, 2026-09-28): the Release workflow published every
// release with GitHub's generated notes alone - one "Full Changelog" line - and
// that body is exactly what filex shows an administrator under "Release notes"
// when it offers the update (Admin -> Plugins -> Apps -> Review update). The
// administrator approving 0.1.1 was told nothing about what 0.1.1 changes.
// The words are already written, in CHANGELOG.md; this hands them over.
//
// A version with no section is an error, not an empty body: a release without
// a changelog entry is a mistake to fix before the tag, and a blank "Release
// notes" would hide it. The section is everything under `## <version>` (the
// rest of the heading line - a date - is the heading's, not the body's) up to
// the next `## ` heading.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The body of `## <version>` in `changelog`, trimmed; null when there is none. */
export function changelogSection(changelog, version) {
  const lines = changelog.replace(/\r\n/g, '\n').split('\n');
  const esc = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const head = new RegExp(`^## \\[?v?${esc}\\]?(\\s|$)`);
  const start = lines.findIndex((l) => head.test(l));
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) {
      end = i;
      break;
    }
  }
  const body = lines.slice(start + 1, end).join('\n').trim();
  return body === '' ? null : body;
}

function main() {
  const version = (process.argv[2] ?? '').replace(/^v/, '');
  if (!version) {
    process.stderr.write('usage: node scripts/release-body.mjs <version>\n');
    process.exit(2);
  }
  const changelog = readFileSync(resolve(ROOT, 'CHANGELOG.md'), 'utf8');
  const body = changelogSection(changelog, version);
  if (body === null) {
    process.stderr.write(`CHANGELOG.md has no "## ${version}" section with text in it: write what ${version} changes before tagging it\n`);
    process.exit(1);
  }
  process.stdout.write(`${body}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
