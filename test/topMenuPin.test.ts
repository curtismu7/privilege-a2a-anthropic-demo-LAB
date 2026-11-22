import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// Rule 22: the shared TopMenu is vendored byte for byte into web/src/top-menu/ and never hand-edited. The pin file lists the
// sha256 of each pinned file (TopMenu.jsx and top-menu.css at least); an edited copy must fail here, and so in CI.
const vendored = fileURLToPath(new URL('../web/src/top-menu/', import.meta.url));
const sha = (file: string): string => createHash('sha256').update(readFileSync(file)).digest('hex');

/** The problems with a vendored directory: a missing pinned file, a hash that differs from the pin, or a required file not pinned. */
function pinProblems(dir: string): string[] {
  const problems: string[] = [];
  const pins = new Map<string, string>();
  for (const line of readFileSync(join(dir, 'top-menu.sha256'), 'utf8').split('\n').filter(l => l.trim())) {
    const [hash, name] = line.trim().split(/\s+/);
    if (hash && name) pins.set(basename(name), hash); // bare names, or the canonical file's path prefix
  }
  for (const required of ['TopMenu.jsx', 'top-menu.css']) if (!pins.has(required)) problems.push(`${required} is not pinned`);
  for (const [name, hash] of pins) {
    try { if (sha(join(dir, name)) !== hash) problems.push(`${name} differs from its pin`); } catch { problems.push(`${name} is missing`); }
  }
  return problems;
}

test('the vendored top-menu directory is whole and every pinned file matches its sha256 pin', () => {
  const files = readdirSync(vendored).sort();
  // TopMenu.jsx imports ReleaseNotes.jsx: a re-vendor copies every file of shared/top-menu/, not just the two pinned ones.
  assert.deepEqual(files, ['README.md', 'ReleaseNotes.jsx', 'TopMenu.jsx', 'top-menu.css', 'top-menu.sha256']);
  assert.deepEqual(pinProblems(vendored), []);
});

test('an edited copy fails the pin: one changed byte in TopMenu.jsx or top-menu.css, a deleted file, or a dropped pin line', () => {
  const work = mkdtempSync(join(tmpdir(), 'top-menu-pin-'));
  try {
    for (const [file, tweak] of [['TopMenu.jsx', '\n// hand edit'], ['top-menu.css', '\n/* hand edit */']] as const) {
      const copy = join(work, file);
      cpSync(vendored, copy, { recursive: true });
      writeFileSync(join(copy, file), readFileSync(join(copy, file), 'utf8') + tweak);
      assert.deepEqual(pinProblems(copy), [`${file} differs from its pin`], file);
    }
    const gone = join(work, 'gone');
    cpSync(vendored, gone, { recursive: true });
    rmSync(join(gone, 'top-menu.css'));
    assert.deepEqual(pinProblems(gone), ['top-menu.css is missing']);
    const dropped = join(work, 'dropped');
    cpSync(vendored, dropped, { recursive: true });
    writeFileSync(join(dropped, 'top-menu.sha256'), readFileSync(join(dropped, 'top-menu.sha256'), 'utf8').split('\n').filter(l => !l.includes('top-menu.css')).join('\n'));
    assert.deepEqual(pinProblems(dropped), ['top-menu.css is not pinned']);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
