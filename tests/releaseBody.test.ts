// The GitHub release's body is the version's CHANGELOG.md section
// (scripts/release-body.mjs), and the Release workflow publishes it.
//
// ⚠ Why (filex task #122): 0.1.1 was released with GitHub's generated notes
// alone - one "Full Changelog" line - and that body is what filex shows an
// administrator under "Release notes" on "Review update". The changelog said
// what 0.1.1 changed; the release did not.
//
// RED PROOF: before this, scripts/release-body.mjs did not exist and the
// workflow passed no body (`generate_release_notes` alone).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = join(ROOT, 'scripts', 'release-body.mjs');

function bodyOf(version: string, root = ROOT): string {
  return execFileSync(process.execPath, [join(root, 'scripts', 'release-body.mjs'), version], { encoding: 'utf8' });
}

/** A copy of the script beside a CHANGELOG.md of the test's own. */
function sandbox(changelog: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'release-body-'));
  mkdirSync(join(dir, 'scripts'));
  copyFileSync(SCRIPT, join(dir, 'scripts', 'release-body.mjs'));
  writeFileSync(join(dir, 'CHANGELOG.md'), changelog);
  return dir;
}

describe('release body', () => {
  it("is the version's CHANGELOG.md section, without its heading or the next version's", () => {
    const body = bodyOf('0.1.1');
    expect(body).toContain('The install review gives a reason for every permission');
    expect(body).not.toMatch(/^## /m);
    expect(body).not.toContain('First release'); // that is 0.1.0's
    expect(bodyOf('v0.1.0')).toContain('First release');
  });

  it("is this repository's own changelog for the version filex-app.json carries", () => {
    const version = JSON.parse(readFileSync(join(ROOT, 'filex-app.json'), 'utf8')).version as string;
    expect(bodyOf(version).trim().length).toBeGreaterThan(20);
  });

  it('keeps the Markdown as written, and stops at the next version', () => {
    const dir = sandbox(
      ['# Changelog', '', '## 0.2.0 - 2026-10-01', '', '- **Bold** and `code`', '  - nested', '', '### Fixed', '', '- a fix', '', '## 0.1.0', '', '- old'].join('\r\n'),
    );
    expect(bodyOf('0.2.0', dir)).toBe('- **Bold** and `code`\n  - nested\n\n### Fixed\n\n- a fix\n');
  });

  it('refuses a version with no section - a release with no notes is a mistake, not an empty body', () => {
    const dir = sandbox('# Changelog\n\n## 0.1.0\n\n- first\n\n## 0.1.1\n\n');
    for (const version of ['9.9.9', '0.1.1', '0.1']) {
      expect(() => execFileSync(process.execPath, [join(dir, 'scripts', 'release-body.mjs'), version], { stdio: 'pipe' }), version).toThrow();
    }
  });

  it('is what the Release workflow publishes', () => {
    const wf = readFileSync(join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
    expect(wf).toMatch(/node scripts\/release-body\.mjs "\$\{GITHUB_REF_NAME#v\}" > release\/release-notes\.md/);
    expect(wf).toMatch(/body_path: release\/release-notes\.md/);
  });
});
