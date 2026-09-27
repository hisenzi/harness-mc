import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const scriptPath = fileURLToPath(new URL('./release-tracking-actions.mjs', import.meta.url));
const tempRoots = [];
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const makeTemp = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-actions-test-')); tempRoots.push(root); return root; };
async function adapter() {
  assert.ok(fs.existsSync(scriptPath), 'the Actions adapter must exist and implement the tested event/replay contract');
  return import(new URL('./release-tracking-actions.mjs', import.meta.url));
}
function fixture() {
  const root = makeTemp();
  git(root, 'init', '-q');
  git(root, 'config', 'user.name', 'Release Tracking Test');
  git(root, 'config', 'user.email', 'release-tracking@example.invalid');
  fs.writeFileSync(path.join(root, 'fixture.txt'), 'A\n');
  git(root, 'add', 'fixture.txt');
  git(root, 'commit', '-qm', 'fixture A');
  const sha = git(root, 'rev-parse', 'HEAD');
  const tag = 'v0.0.0-issue2-test-delivery';
  git(root, 'tag', '-a', tag, '-m', 'annotated fixture');
  const tagObject = git(root, 'rev-parse', `refs/tags/${tag}`);
  const repo = 'fixture-owner/pilot';
  const event = { ref: `refs/tags/${tag}`, after: tagObject, before: '0'.repeat(40), deleted: false, created: true, repository: { full_name: repo }, head_commit: { timestamp: '2026-09-27T00:00:00Z' } };
  const env = { GITHUB_EVENT_NAME: 'push', GITHUB_REF: event.ref, GITHUB_SHA: sha, GITHUB_REPOSITORY: repo, GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', GITHUB_SERVER_URL: 'https://github.com' };
  const activation = { schema_version: 1, status: 'authorized', repo, target: { kind: 'issue', repo, number: 17 }, allowed_tags: [{ tag, commit_shas: [sha] }], allowed_write_types: ['issue_comment', 'tag_repoint_notice'], operator: 'fixture-operator', authorization: { source: 'fixture authorization', approved_at: '2026-09-27T00:00:00Z' }, workflow: { path: '.github/workflows/release-tracking.yml', disable_command: 'fixture only' } };
  return { root, sha, tagObject, tag, repo, event, env, activation };
}

test.after(() => { for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true }); });

test('normalizes an annotated push using its immutable object and verifies the checked-out commit', async () => {
  const { normalizeActionsEvent } = await adapter();
  const f = fixture();
  const normalized = normalizeActionsEvent({ event: f.event, env: f.env, checkoutDir: f.root, activation: f.activation });
  assert.equal(normalized.commit_sha, f.sha);
  assert.notEqual(normalized.commit_sha, f.tagObject);
  assert.equal(normalized.fixture, true);
  assert.deepEqual(normalized.routing, { mode: 'existing', target: f.activation.target });
  assert.equal(normalized.ref, f.event.ref);
});

test('a rerun stays bound to its original event even after the tag moves', async () => {
  const { normalizeActionsEvent } = await adapter();
  const f = fixture();
  fs.writeFileSync(path.join(f.root, 'fixture.txt'), 'B\n');
  git(f.root, 'commit', '-qam', 'fixture B');
  const newSha = git(f.root, 'rev-parse', 'HEAD');
  git(f.root, 'tag', '-f', f.tag, newSha);
  git(f.root, 'checkout', '--detach', f.sha);
  const normalized = normalizeActionsEvent({ event: f.event, env: { ...f.env, GITHUB_RUN_ATTEMPT: '2' }, checkoutDir: f.root, activation: f.activation });
  assert.equal(normalized.commit_sha, f.sha);
  assert.equal(git(f.root, 'rev-parse', `refs/tags/${f.tag}^{commit}`), newSha);
});

test('rejects mismatched checkout, ref, repo, missing SHA, and unapproved tag before generating materials', async () => {
  const { normalizeActionsEvent } = await adapter();
  const f = fixture();
  for (const [env, pattern] of [
    [{ ...f.env, GITHUB_SHA: 'a'.repeat(40) }, /checkout|commit/i],
    [{ ...f.env, GITHUB_REF: 'refs/tags/other' }, /ref/i],
    [{ ...f.env, GITHUB_REPOSITORY: 'other/repo' }, /repo/i],
    [{ ...f.env, GITHUB_SHA: undefined }, /40|SHA|commit/i],
  ]) assert.throws(() => normalizeActionsEvent({ event: f.event, env, checkoutDir: f.root, activation: f.activation }), pattern);
  assert.throws(() => normalizeActionsEvent({ event: f.event, env: f.env, checkoutDir: f.root, activation: { ...f.activation, allowed_tags: [] } }), /allow|authoriz|tag/i);
});

test('capture records a real fixture command, hashes all immutable materials, and restores without rerendering', async (t) => {
  const { captureBundle, restoreBundle, verifyBundle } = await adapter();
  const f = fixture();
  const parent = makeTemp();
  const original = path.join(parent, 'original');
  await captureBundle({ event: f.event, env: f.env, activation: f.activation, checkoutDir: f.root, outDir: original });
  const manifest = verifyBundle(original);
  for (const name of ['input/event.json', 'input/contract.json', 'input/result.json', 'plan/plan.json', 'plan/message.md', 'input/evidence/stdout.log', 'input/evidence/stderr.log']) assert.ok(manifest.files[name], `missing hash for ${name}`);
  const resultBytes = fs.readFileSync(path.join(original, 'input/result.json'));
  const result = JSON.parse(resultBytes);
  assert.equal(result.source_commit, f.sha);
  assert.equal(result.ci.url, `https://github.com/${f.repo}/actions/runs/123`);
  assert.match(result.cases[0].command, /verify-release-tracking\.mjs/);
  assert.equal(typeof result.cases[0].exit_code, 'number');
  assert.ok(result.cases[0].duration_ms >= 0);
  const commandOutput = fs.readFileSync(path.join(original, 'input/evidence/stdout.log'), 'utf8') + fs.readFileSync(path.join(original, 'input/evidence/stderr.log'), 'utf8');
  assert.ok(commandOutput.length > 0, 'a real verifier execution must retain its stdout/stderr evidence');
  assert.equal(result.cases[0].status, result.cases[0].exit_code === 0 ? 'PASS' : 'FAIL');
  t.diagnostic(`captured verifier exit=${result.cases[0].exit_code}; result=${result.cases[0].status}`);
  if (result.cases[0].exit_code !== 0) t.diagnostic(commandOutput.trim());
  const restored = path.join(parent, 'restored');
  restoreBundle({ bundleDir: original, outDir: restored, event: f.event, env: { ...f.env, GITHUB_RUN_ATTEMPT: '2' }, checkoutDir: f.root, activation: f.activation });
  assert.deepEqual(fs.readFileSync(path.join(restored, 'input/result.json')), resultBytes);
  assert.deepEqual(fs.readFileSync(path.join(restored, 'plan/message.md')), fs.readFileSync(path.join(original, 'plan/message.md')));
  const replayPlan = JSON.parse(fs.readFileSync(path.join(restored, 'plan/plan.json')));
  assert.equal(replayPlan.material_paths.event, path.join(restored, 'input/event.json'));
  assert.equal(replayPlan.material_paths.evidence_root, path.join(restored, 'input'));
  const replay = JSON.parse(fs.readFileSync(path.join(restored, 'replay.json')));
  assert.equal(replay.original_plan_sha256, manifest.files['plan/plan.json']);
  assert.equal(replay.body_sha256, manifest.files['plan/message.md']);
  verifyBundle(restored);
  assert.equal(fs.existsSync(path.join(restored, 'state')), false, 'bundles must not restore an old ledger');
  assert.throws(() => restoreBundle({ bundleDir: original, outDir: restored, event: f.event, env: f.env, checkoutDir: f.root, activation: f.activation }), /exist/i);
  await t.test('fresh checkout restores the archived annotated event without its now-unreferenced tag object', () => {
    fs.writeFileSync(path.join(f.root, 'fixture.txt'), 'B\n');
    git(f.root, 'commit', '-qam', 'fixture B after capture');
    git(f.root, 'tag', '-f', f.tag, 'HEAD');
    const transfer = path.join(parent, 'commit-history.bundle');
    git(f.root, 'bundle', 'create', transfer, 'HEAD');
    const fresh = makeTemp();
    git(fresh, 'init', '-q');
    git(fresh, 'fetch', transfer, 'HEAD');
    git(fresh, 'checkout', '--detach', f.sha);
    assert.notEqual(spawnSync('git', ['-C', fresh, 'cat-file', '-e', f.tagObject]).status, 0, 'fresh checkout must actually lack the old annotated object');
    const replayOut = path.join(parent, 'fresh-replay');
    restoreBundle({ bundleDir: original, outDir: replayOut, event: f.event, env: { ...f.env, GITHUB_RUN_ATTEMPT: '2' }, checkoutDir: fresh, activation: f.activation });
    assert.deepEqual(fs.readFileSync(path.join(replayOut, 'plan/message.md')), fs.readFileSync(path.join(original, 'plan/message.md')));
    assert.deepEqual(fs.readFileSync(path.join(replayOut, 'input/result.json')), resultBytes);
    assert.throws(() => restoreBundle({ bundleDir: original, outDir: path.join(parent, 'wrong-event'), event: { ...f.event, after: f.sha }, env: { ...f.env, GITHUB_RUN_ATTEMPT: '2' }, checkoutDir: fresh, activation: f.activation }), /archiv|original|event/i);
  });
  fs.appendFileSync(path.join(original, 'plan/message.md'), '\ncorrupt');
  assert.throws(() => verifyBundle(original), /hash/i);
});

test('bundle verifier rejects path traversal, symlinks, and undeclared files', async () => {
  const { verifyBundle } = await adapter();
  const root = makeTemp();
  fs.writeFileSync(path.join(root, 'bundle-manifest.json'), JSON.stringify({ schema_version: 1, files: { '../outside': 'a'.repeat(64) } }));
  assert.throws(() => verifyBundle(root), /path|outside|escape/i);
  fs.writeFileSync(path.join(root, 'bundle-manifest.json'), JSON.stringify({ schema_version: 1, files: { 'secret-link': 'a'.repeat(64) } }));
  fs.symlinkSync('/etc/hosts', path.join(root, 'secret-link'));
  assert.throws(() => verifyBundle(root), /symlink/i);
  fs.unlinkSync(path.join(root, 'secret-link'));
  fs.writeFileSync(path.join(root, 'extra'), 'undeclared');
  fs.writeFileSync(path.join(root, 'bundle-manifest.json'), JSON.stringify({ schema_version: 1, files: {} }));
  assert.throws(() => verifyBundle(root), /undeclared|manifest|missing/i);
});

test('the command-line entry rejects invalid commands with a nonzero exit', async () => {
  await adapter();
  const child = spawnSync(process.execPath, [scriptPath, 'unknown-command'], { encoding: 'utf8' });
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /unknown command/i);
});
