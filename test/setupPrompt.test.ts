import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// The hidden key prompt of npm run setup needs a real terminal, so it is driven through a pseudo-terminal (Python's pty module).
// It asserts what the spec promises: typed keys are never echoed, Enter leaves a key unchanged, Ctrl-C writes nothing and exits 130.
// Spec: docs/specs/2026-11-25-setup-script-v1.md. Skipped, with a reason, where python3 or a pty is not available.
const root = `${dirname(dirname(fileURLToPath(import.meta.url)))}/`;
const KEY1 = 'typed-main-key-AAAAAAAAAAAAAAAAAAAA1';
const KEY2 = 'typed-worker-key-BBBBBBBBBBBBBBBBBBB2';

const DRIVER = String.raw`
import json, os, pty, select, sys, time
root, env_file, scenario = sys.argv[1], sys.argv[2], sys.argv[3]
inputs = {"both": [os.environ["K1"] + "\r", os.environ["K2"] + "\r"], "skip": [os.environ["K1"] + "\r", "\r"], "ctrlc": ["\x03"]}[scenario]
pid, fd = pty.fork()
if pid == 0:
    os.chdir(root)
    for name in ("MAIN_AGENT_KEY", "WORKER_AGENT_KEY"):
        os.environ.pop(name, None)
    os.execvp("node", ["node", "scripts/setup.mjs", "--apply", "--file", env_file, "--gateway", "gw.example", "--main-model", "m1", "--worker-model", "m2"])
buf = b""; sent = 0; end = time.time() + 25
while time.time() < end:
    ready, _, _ = select.select([fd], [], [], 0.3)
    if ready:
        try:
            chunk = os.read(fd, 4096)
        except OSError:
            break
        if not chunk:
            break
        buf += chunk
    if sent < len(inputs) and buf.lower().count(b"hidden") > sent:
        time.sleep(0.3); os.write(fd, inputs[sent].encode()); sent += 1
try:
    _, status = os.waitpid(pid, 0)
    code = os.waitstatus_to_exitcode(status)
except ChildProcessError:
    code = -1
print(json.dumps({"code": code, "output": buf.decode(errors="replace")}))
`;

const hasPty = spawnSync('python3', ['-c', 'import pty, select'], { encoding: 'utf8' }).status === 0;

function drive(scenario: 'both' | 'skip' | 'ctrlc'): { code: number; output: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'setup-pty-'));
  const file = join(dir, '.env');
  const r = spawnSync('python3', ['-c', DRIVER, root, file, scenario], { encoding: 'utf8', env: { ...process.env, K1: KEY1, K2: KEY2 }, timeout: 60000 });
  assert.equal(r.status, 0, r.stderr);
  const parsed = JSON.parse(r.stdout) as { code: number; output: string };
  return { ...parsed, file };
}

test('hidden prompt: both keys typed are never echoed, are written to a mode-600 .env, and the tool never prints them', { skip: hasPty ? false : 'python3 with the pty module is not available' }, () => {
  const r = drive('both');
  assert.equal(r.code, 0, r.output);
  assert.ok(!r.output.includes(KEY1) && !r.output.includes(KEY2), 'a typed key was echoed to the terminal');
  assert.match(r.output, /Main agent key \(hidden/); assert.match(r.output, /Worker key \(hidden/);
  const text = readFileSync(r.file, 'utf8');
  assert.ok(text.includes(`MAIN_AGENT_KEY=${KEY1}`) && text.includes(`WORKER_AGENT_KEY=${KEY2}`));
  assert.equal(statSync(r.file).mode & 0o777, 0o600);
});

test('hidden prompt: pressing Enter leaves that key unchanged (nothing is written for it) and the other is still stored', { skip: hasPty ? false : 'python3 with the pty module is not available' }, () => {
  const r = drive('skip');
  assert.equal(r.code, 0, r.output);
  assert.ok(!r.output.includes(KEY1));
  const text = readFileSync(r.file, 'utf8');
  assert.ok(text.includes(`MAIN_AGENT_KEY=${KEY1}`));
  assert.ok(!text.includes('typed-worker-key'), 'the skipped key was not invented');
  assert.match(r.output, /no worker key given/);
});

test('hidden prompt: Ctrl-C at the first prompt exits 130, writes no file and echoes nothing', { skip: hasPty ? false : 'python3 with the pty module is not available' }, () => {
  const r = drive('ctrlc');
  assert.equal(r.code, 130, r.output);
  assert.ok(!existsSync(r.file), 'no .env was written');
  assert.match(r.output, /cancelled: nothing was written/);
});
