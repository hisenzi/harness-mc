import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { generateCommitAttention } from './generate-commit-attention.mjs';
import { generateCommitCleanupPlan } from './generate-commit-cleanup-plan.mjs';
import { digest, loadWorkbook, workId } from './lib/workbook-anchor.mjs';

const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'workbook-visibility-')));
const failures = [];
let passed = 0;
const now = '2026-09-07T01:00:00.000Z';
const ownPaths = Array.from({ length: 31 }, (_, index) => `src/file-${index}.txt`).concat('src/file with spaces.txt');
const git = (...args) => {
  const result = spawnSync('git', args, { cwd: temporary, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
const run = (name, test) => {
  const originalWrite = fs.writeFileSync, originalMkdir = fs.mkdirSync;
  fs.writeFileSync = () => assert.fail('unexpected file write from a read-only generator');
  fs.mkdirSync = () => assert.fail('unexpected directory write from a read-only generator');
  try { test(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failures.push({ name, message: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
  finally { fs.writeFileSync = originalWrite; fs.mkdirSync = originalMkdir; }
};

try {
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Workbook Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  fs.writeFileSync(path.join(temporary, 'base.txt'), 'base\n');
  fs.writeFileSync(path.join(temporary, 'verify.mjs'), 'process.exit(0);\n');
  git('add', '--', 'base.txt');
  git('commit', '-qm', 'fixture base');
  fs.mkdirSync(path.join(temporary, 'src'));
  for (const file of ownPaths) fs.writeFileSync(path.join(temporary, file), 'uncommitted\n');
  fs.writeFileSync(path.join(temporary, 'other.txt'), 'other owner\n');
  git('add', '--', 'other.txt');
  const contract = {
    schema_version: 1, contract_revision: 1, project_id: 'fixture',
    task_id: 'work-11111111-1111-4111-8111-111111111111', title: 'Fixture work', order_label: null,
    home: { repo_id: 'fixture-repo', path: 'docs/work/fixture/workbook.md' },
    repos: [{ repo_id: 'fixture-repo', canonical_root: temporary, checkout_root: temporary, write_paths: ownPaths }],
    baseline_refs: [{ ref: 'fixture-spec', digest: 'fixture-digest' }], canonical_baseline: null,
    done_condition: 'Only the selected work scope is planned.',
    acceptance: [{ id: 'F01', repo_id: 'fixture-repo', command: process.execPath, args: ['verify.mjs'], executable_sha256: digest(fs.readFileSync(process.execPath)), entrypoint: 'verify.mjs', entrypoint_sha256: digest(fs.readFileSync(path.join(temporary, 'verify.mjs'))), source_paths: ['base.txt', 'verify.mjs'], artifact_paths: ['base.txt'] }],
    dependencies: [], budget: { max_wall_time_ms: 10000, max_attempts: 1 },
    allowed_actions: ['implement', 'verify', 'commit', 'handoff'], approval_refs: ['user:fixture-approval'],
    stop_resume: 'Retain the original workbook and inspect the owner.', formal_target: 'milestones/fixture/tasks.json',
  };
  const workbookPath = path.join(temporary, contract.home.path);
  fs.mkdirSync(path.dirname(workbookPath), { recursive: true });
  fs.writeFileSync(workbookPath, `# Fixture\n<!-- morrowise:workbook:start -->\n\`\`\`json\n${JSON.stringify(contract, null, 2)}\n\`\`\`\n<!-- morrowise:workbook:end -->\n`);
  const workbook = loadWorkbook(workbookPath);
  const claim = {
    version: 1, work_id: workId(contract), home: workbookPath,
    contract_fingerprint: workbook.contract_fingerprint, owner: 'fixture-owner', session_id: 'fixture-session',
    scope_paths: ownPaths, state: 'active', updated_at: now,
  };
  const repoSnapshot = {
    decision: 'READY', reason: 'local_scope_ready', dirty_paths: [...ownPaths, 'other.txt', contract.home.path],
    scope_paths: ownPaths, excluded_paths: ['other.txt', contract.home.path], claims: [claim], head: git('rev-parse', 'HEAD'),
  };
  const approvalResolver = request => ({
    ...request, source_ref: 'user:fixture-approval', revoked: false, allowed_actions: contract.allowed_actions,
  });
  const context = overrides => ({
    sessionId: 'fixture-session', now, staleAfterMs: 60 * 60 * 1000, approvalResolver,
    canonicalResolver: ref => ({task_ref:ref,exists:false}),
    inspectClaims: () => [claim], inspectRepo: () => repoSnapshot, ...overrides,
  });
  const options = overrides => ({ workbook: workbookPath, workbookContext: context(), worktrees: { repositories: [] }, root: temporary, write: false, ...overrides });

  run('workbook attention branches before legacy repository discovery and central task reads', () => {
    const input = options();
    Object.defineProperty(input, 'worktrees', { get() { assert.fail('workbook branch entered legacy repository discovery'); } });
    Object.defineProperty(input, 'root', { get() { assert.fail('workbook branch entered central task discovery'); } });
    const attention = generateCommitAttention(input);
    assert.equal(attention.source.kind, 'workbook');
    assert.equal(attention.work.work_id, workId(contract));
    assert.equal(attention.work.execution_state, 'active');
    assert.equal(attention.repositories.length, 1);
  });

  run('selected scope remains complete beyond legacy display sample limits', () => {
    const attention = generateCommitAttention(options());
    const plan = generateCommitCleanupPlan({ commitAttention: attention, write: false });
    assert.equal(plan.plans[0].planning_state, 'plan_allowed');
    assert.deepEqual(plan.plans[0].commit_groups[0].candidate_files_sample, ownPaths);
    assert.deepEqual(plan.plans[0].excluded_files, ['other.txt', contract.home.path]);
    assert.equal(plan.plans[0].commit_groups[0].state, 'pending_scoped_diff_review');
    assert.equal(plan.plans[0].approval_required, true);
  });

  run('cleanup accepts the workbook directly without reading generated attention', () => {
    const input = options();
    Object.defineProperty(input, 'commitAttention', { get() { assert.fail('workbook branch read generated attention'); } });
    const plan = generateCommitCleanupPlan(input);
    assert.equal(plan.source.kind, 'workbook');
    assert.equal(plan.plans[0].candidate_task_anchor.task_id, contract.task_id);
  });

  run('unverified human approval remains readable but never becomes plan_allowed', () => {
    const attention = generateCommitAttention(options({ workbookContext: context({ approvalResolver: undefined }) }));
    assert.equal(attention.work.gate.decision, 'requires_human_approval');
    assert.equal(attention.work.execution_state, 'active');
    const plan = generateCommitCleanupPlan({ commitAttention: attention, write: false });
    assert.equal(plan.plans[0].planning_state, 'requires_human_approval');
    assert.deepEqual(plan.plans[0].commit_groups, []);
  });

  run('cleanup rechecks approval rather than trusting the preceding attention result', () => {
    let revoked = false;
    const attention = generateCommitAttention(options({ workbookContext: context({ approvalResolver: request => ({ ...approvalResolver(request), revoked }) }) }));
    revoked = true;
    const plan = generateCommitCleanupPlan({ commitAttention: attention, write: false });
    assert.notEqual(plan.plans[0].planning_state, 'plan_allowed');
  });

  run('serialized or forged workbook attention is never an approval source', () => {
    const attention = generateCommitAttention(options());
    const serialized = JSON.parse(JSON.stringify(attention));
    const plan = generateCommitCleanupPlan({ commitAttention: serialized, write: false });
    assert.notEqual(plan.plans[0]?.planning_state, 'plan_allowed');
    assert.equal(plan.decision, 'requires_explicit_workbook');
  });

  run('new local scope can be planned with pending push and an unrelated active work', () => {
    const otherClaim = { ...claim, work_id: 'fixture/other-work', scope_paths: ['other.txt'], session_id: 'other-session' };
    const attention = generateCommitAttention(options({ workbookContext: context({
      inspectClaims: () => [claim, otherClaim],
      inspectRepo: () => ({ ...repoSnapshot, claims: [claim, otherClaim], pending_delivery: true }),
    }) }));
    const plan = generateCommitCleanupPlan({ commitAttention: attention, write: false });
    assert.equal(plan.plans[0].planning_state, 'plan_allowed');
    assert.equal(attention.repositories[0].claims.length, 2);
  });

  run('repo ownership conflicts block the selected work', () => {
    const attention = generateCommitAttention(options({ workbookContext: context({
      inspectRepo: () => ({ ...repoSnapshot, decision: 'BLOCKED', reason: 'scope_owned_by_other' }),
    }) }));
    const plan = generateCommitCleanupPlan({ commitAttention: attention, write: false });
    assert.equal(plan.plans[0].planning_state, 'blocked');
    assert.match(plan.plans[0].preflight_result.reason, /scope_owned_by_other/);
    assert.deepEqual(plan.plans[0].commit_groups, []);
  });

  for (const [label, changedClaim, expected] of [
    ['stale claim', { ...claim, updated_at: '2026-09-06T01:00:00.000Z' }, 'stale'],
    ['missing claim', null, 'unknown'],
    ['different home', { ...claim, home: path.join(temporary, 'copied-workbook.md') }, 'unknown'],
    ['changed contract', { ...claim, contract_fingerprint: 'invalid' }, 'unknown'],
    ['pending writeback', { ...claim, state: 'pending_writeback', updated_at: '2026-09-06T01:00:00.000Z' }, 'pending_writeback'],
    ['released claim', { ...claim, state: 'released' }, 'unknown'],
  ]) {
    run(`${label} cannot be mistaken for idle or fresh runnable work`, () => {
      const attention = generateCommitAttention(options({ workbookContext: context({ inspectClaims: () => changedClaim ? [changedClaim] : [] }) }));
      assert.equal(attention.work.execution_state, expected);
      const plan = generateCommitCleanupPlan({ commitAttention: attention, write: false });
      assert.notEqual(plan.plans[0].planning_state, 'plan_allowed');
    });
  }

  run('claim read failure is unknown and cannot initiate ownership', () => {
    const attention = generateCommitAttention(options({ workbookContext: context({ inspectClaims: () => { throw new Error('claim_unavailable'); } }) }));
    assert.equal(attention.work.execution_state, 'unknown');
    assert.equal(attention.repositories[0].observation_error, 'claim_unavailable');
  });

  run('both workbook generators reject central writes and notifications explicitly', () => {
    for (const generator of [generateCommitAttention, generateCommitCleanupPlan]) {
      assert.throws(() => generator(options({ write: true })), /workbook_read_only/);
      assert.throws(() => generator(options({ notify: true })), /workbook_read_only/);
    }
    const attention = generateCommitAttention(options());
    assert.throws(() => generateCommitCleanupPlan({ commitAttention: attention, write: true }), /workbook_read_only/);
  });

  run('default workbook generation never writes files or changes the index', () => {
    const originalWrite = fs.writeFileSync, originalMkdir = fs.mkdirSync;
    const indexBefore = git('ls-files', '--stage');
    try {
      fs.writeFileSync = () => assert.fail('unexpected generated file write');
      fs.mkdirSync = () => assert.fail('unexpected generated directory write');
      const attention = generateCommitAttention(options({ write: undefined }));
      const plan = generateCommitCleanupPlan({ commitAttention: attention });
      assert.equal(plan.read_only, true);
    } finally { fs.writeFileSync = originalWrite; fs.mkdirSync = originalMkdir; }
    assert.equal(git('ls-files', '--stage'), indexBefore);
  });

  run('invalid explicit workbook input cannot fall back to the legacy writer', () => {
    for (const generator of [generateCommitAttention, generateCommitCleanupPlan]) {
      assert.throws(() => generator({ workbook: null, worktrees: { repositories: [] }, root: temporary, write: false }), /workbook_path_required/);
    }
  });

  run('real default readers and both CLIs observe without claiming or approving', () => {
    const attention = generateCommitAttention({ workbook: workbookPath, worktrees: { repositories: [] }, root: temporary, write: false });
    assert.equal(attention.source.kind, 'workbook');
    assert.equal(attention.work.execution_state, 'unknown');
    assert.equal(attention.work.gate.decision, 'requires_human_approval');
    const scriptDir = path.dirname(fileURLToPath(import.meta.url));
    const indexBefore = git('ls-files', '--stage');
    for (const filename of ['generate-commit-attention.mjs', 'generate-commit-cleanup-plan.mjs']) {
      const output = spawnSync(process.execPath, [path.join(scriptDir, filename), '--workbook', workbookPath], { encoding: 'utf8' });
      assert.equal(output.status, 0, output.stderr || output.stdout);
      const data = JSON.parse(output.stdout);
      assert.equal(data.source.kind, 'workbook');
      if (data.plans) assert.notEqual(data.plans[0].planning_state, 'plan_allowed');
      const rejected = spawnSync(process.execPath, [path.join(scriptDir, filename), '--workbook', workbookPath, '--notify'], { encoding: 'utf8' });
      assert.equal(rejected.status, 2);
      assert.match(rejected.stdout, /workbook_read_only/);
    }
    assert.equal(git('ls-files', '--stage'), indexBefore);
    assert.equal(fs.existsSync(path.join(temporary, '.git', 'morrowise-workbooks-v1')), false, 'readers must not create claim storage');
  });

  const claimsDirectory = path.join(temporary, '.git', 'morrowise-workbooks-v1', 'claims');
  const claimPath = path.join(claimsDirectory, `${digest(workId(contract))}.json`);
  fs.mkdirSync(claimsDirectory, { recursive: true });
  fs.writeFileSync(claimPath, JSON.stringify(claim));
  run('real claim readers retain complete owned scope and preserve claim storage', () => {
    const claimBefore = fs.readFileSync(claimPath, 'utf8');
    const attention = generateCommitAttention({ workbook: workbookPath, workbookContext: { now, approvalResolver, canonicalResolver:ref=>({task_ref:ref,exists:false}), sessionId: 'fixture-session' } });
    assert.equal(attention.work.execution_state, 'active');
    const plan = generateCommitCleanupPlan({ commitAttention: attention });
    assert.equal(plan.plans[0].planning_state, 'plan_allowed');
    assert.deepEqual(new Set(plan.plans[0].commit_groups[0].candidate_files_sample), new Set(ownPaths));
    assert.ok(plan.plans[0].excluded_files.includes('other.txt'));
    assert.equal(fs.readFileSync(claimPath, 'utf8'), claimBefore);
  });

  // This detached checkout is an isolated fixture, never a project worktree.
  const linked = path.join(temporary, 'linked-fixture');
  git('worktree', 'add', '--detach', linked, 'HEAD');
  fs.mkdirSync(path.join(linked, 'src'));
  fs.writeFileSync(path.join(linked, ownPaths[0]), 'linked work\n');
  contract.repos[0].checkout_root = linked;
  fs.writeFileSync(workbookPath, `# Fixture\n<!-- morrowise:workbook:start -->\n\`\`\`json\n${JSON.stringify(contract, null, 2)}\n\`\`\`\n<!-- morrowise:workbook:end -->\n`);
  run('a changed workbook cannot reuse a claim bound to its previous contract', () => {
    const attention = generateCommitAttention({ workbook: workbookPath, workbookContext: { now, approvalResolver, canonicalResolver:ref=>({task_ref:ref,exists:false}), sessionId: 'fixture-session' } });
    assert.equal(attention.work.execution_state, 'unknown');
    assert.notEqual(generateCommitCleanupPlan({ commitAttention: attention }).plans[0].planning_state, 'plan_allowed');
  });
  fs.writeFileSync(claimPath, JSON.stringify({ ...claim, contract_fingerprint: loadWorkbook(workbookPath).contract_fingerprint }));
  run('linked checkout reads the shared claim and original workbook home', () => {
    const attention = generateCommitAttention({ workbook: workbookPath, workbookContext: { now, approvalResolver, canonicalResolver:ref=>({task_ref:ref,exists:false}), sessionId: 'fixture-session' } });
    assert.equal(attention.work.execution_state, 'active');
    assert.equal(attention.work.home, workbookPath);
    assert.equal(attention.repositories[0].path_label, linked);
    assert.deepEqual(attention.repositories[0].candidate_paths, [ownPaths[0]]);
    assert.equal(attention.repositories[0].claims[0].home, workbookPath);
  });
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

if (failures.length) {
  console.error(JSON.stringify({ passed, failed: failures.length, failures }, null, 2));
  process.exitCode = 1;
} else console.log(`Workbook visibility verification OK (${passed} cases)`);
