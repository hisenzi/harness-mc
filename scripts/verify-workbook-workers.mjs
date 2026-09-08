// WF-V05: real independent Node workers, isolated Git fixtures only.
// Installed usage: node scripts/verify-workbook-workers.mjs
// Candidate usage: node <candidate> --library-root <scripts/lib>
// The fixture driver is the authority for exact workbook/operation grants below.
// These in-memory test resolvers do NOT claim a production human/session bridge.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fork, spawnSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';

// Confine every Git command (including those inside copied helpers) to fixtures,
// even when the runner inherited an index/worktree override from its caller.
for (const key of Object.keys(process.env)) if (key.startsWith('GIT_')) delete process.env[key];
process.env.GIT_CONFIG_NOSYSTEM = '1';
process.env.GIT_CONFIG_GLOBAL = os.devNull;

const self = fileURLToPath(import.meta.url);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const git = (cwd, ...args) => {
  const r = spawnSync('git', ['--literal-pathspecs', ...args], {cwd, encoding: 'utf8'});
  assert.equal(r.status, 0, `${args[0]}: ${r.stderr}`);
  return r.stdout.trimEnd();
};
const modules = async root => ({
  ...await import(pathToFileURL(path.join(root, 'workbook-anchor.mjs')).href),
  ...await import(pathToFileURL(path.join(root, 'workbook-coordination.mjs')).href)
});

function syncBarrier(directory, phase) {
  const marker = path.join(directory, `${phase}.ready`);
  fs.writeFileSync(marker, String(process.pid), {flag: 'wx'});
  const until = Date.now() + 20000;
  while (!fs.existsSync(path.join(directory, `${phase}.release`))) {
    assert.ok(Date.now() < until, `fixture barrier timeout: ${phase}`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
}

async function workerMain(libraryRoot) {
  const api = await modules(libraryRoot);
  let fixture;
  process.on('message', ({id, action, data = {}}) => {
    try {
      if (action === 'init') {
        assert.equal(fixture, undefined, 'fixture identity is immutable');
        fixture = Object.freeze(data);
        process.send({id, result: {pid: process.pid}});
        return;
      }
      assert.ok(fixture, 'fixture must initialize before work');
      const workbook = api.loadWorkbook(fixture.home);
      assert.equal(api.workId(workbook.contract), fixture.work_id);
      assert.equal(workbook.contract_fingerprint, fixture.contract_fingerprint);
      const repo = workbook.contract.repos[0].checkout_root;
      const options = {
        workbook, repoId: 'fixture', sessionId: fixture.session_id,
        owner: `Fixture ${fixture.session_id}`,
        // Fixture-only grant: exact identity and caller-approved operation. No
        // Markdown self-approved flag or unchecked request echo authorizes work.
        approvalResolver: request => {
          if (request.work_id !== fixture.work_id ||
              request.contract_fingerprint !== fixture.contract_fingerprint ||
              !fixture.allowed_actions.includes(request.action)) return null;
          if (request.action === 'commit' &&
              (!data.operation || request.operation_fingerprint !== api.digest(data.operation))) return null;
          return {
            source_ref: fixture.source_ref, work_id: fixture.work_id,
            contract_fingerprint: fixture.contract_fingerprint,
            allowed_actions: fixture.allowed_actions, revoked: false,
            ...(request.action === 'commit' ? {operation_fingerprint: api.digest(data.operation)} : {})
          };
        },
        // An explicitly empty, identity-bound fixture task store; not production.
        canonicalResolver: ref => ref === fixture.work_id ? {task_ref: ref, exists: false} : null
      };
      let result;
      if (action === 'claim') {
        if (data.barrier) syncBarrier(data.barrier, 'claim');
        result = api.acquireWorkbookClaim(options);
      } else if (action === 'inspect') {
        result = api.inspectWorkbookRepo(options);
      } else if (action === 'release') {
        result = api.releaseWorkbookClaim(options);
      } else if (action === 'edit') {
        assert.deepEqual(workbook.contract.repos[0].write_paths, [data.file]);
        fs.writeFileSync(path.join(repo, data.file), data.content);
        if (data.stage) git(repo, 'add', '--', data.file);
        result = {decision: 'READY', reason: 'fixture_owned_file_changed'};
      } else if (action === 'commit') {
        result = api.commitWorkbookC1({
          ...options, eventId: data.event_id, message: data.message,
          scopePaths: [fixture.file],
          ...(data.verify_barrier ? {afterVerify: () => syncBarrier(data.verify_barrier, 'verify')} : {}),
          ...(data.commit_barrier ? {afterCommit: () => syncBarrier(data.commit_barrier, 'commit')} : {})
        });
      } else throw Error(`unsupported fixture action: ${action}`);
      process.send({id, result: {pid: process.pid, ...result}});
    } catch (error) {
      process.send({id, error: error.stack});
    }
  });
  process.on('disconnect', () => process.exit(0));
}

function startWorker(libraryRoot) {
  const child = fork(self, ['--fixture-worker', libraryRoot], {
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'], execArgv: []
  });
  const pending = new Map();
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.on('message', reply => {
    const item = pending.get(reply.id);
    if (!item) return;
    pending.delete(reply.id);
    clearTimeout(item.timer);
    if (reply.error) item.reject(Error(reply.error));
    else item.resolve(reply.result);
  });
  const rejectPending = error => {
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); }
    pending.clear();
  };
  child.on('error', rejectPending);
  child.on('exit', (code, signal) => rejectPending(Error(`worker exited ${code}/${signal}: ${stderr}`)));
  return {
    child,
    rpc(action, data) {
      return new Promise((resolve, reject) => {
        const id = crypto.randomUUID();
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(Error(`worker RPC timeout: ${action}; ${stderr}`));
        }, 30000);
        pending.set(id, {resolve, reject, timer});
        child.send({id, action, data}, error => {
          if (error) { clearTimeout(timer); pending.delete(id); reject(error); }
        });
      });
    },
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      await new Promise(resolve => {
        child.once('exit', resolve);
        child.kill('SIGTERM');
      });
    }
  };
}

async function waitFor(file) {
  const until = Date.now() + 20000;
  while (!fs.existsSync(file)) {
    assert.ok(Date.now() < until, `fixture did not reach barrier: ${file}`);
    await delay(10);
  }
}
const release = (directory, phase) => fs.writeFileSync(path.join(directory, `${phase}.release`), 'go', {flag: 'wx'});
const ready = result => assert.equal(result.decision, 'READY', JSON.stringify(result));
async function claimWithBusyRetry(worker) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const result = await worker.rpc('claim');
    if (result.reason !== 'local_lock_held') return result;
    await delay(10);
  }
  throw Error('claim remained busy; no forced recovery or owner takeover attempted');
}

async function run() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mw-two-workers-')));
  const workers = [];
  try {
    const arg = process.argv.indexOf('--library-root');
    const libraryRoot = arg >= 0 ? process.argv[arg + 1] : path.join(path.dirname(self), 'lib');
    assert.ok(libraryRoot, '--library-root requires a path');
    const copied = path.join(base, 'lib');
    fs.mkdirSync(copied);
    const snapshots = {};
    const names = ['workbook-anchor.mjs', 'workbook-coordination.mjs'];
    for (const name of names) {
      const bytes = fs.readFileSync(path.join(libraryRoot, name));
      snapshots[name] = hash(bytes);
      fs.writeFileSync(path.join(copied, name), bytes, {flag: 'wx'});
    }
    for (const name of names) assert.equal(hash(fs.readFileSync(path.join(libraryRoot, name))), snapshots[name], 'helper changed while taking snapshot');
    const api = await modules(copied);
    const executableHash = api.digest(fs.readFileSync(process.execPath));
    const verifier = "import assert from 'node:assert/strict';import fs from 'node:fs';assert.equal(fs.readFileSync(process.argv[2],'utf8'),process.argv[3]);\n";
    const newRepo = name => {
      const repo = path.join(base, name);
      fs.mkdirSync(repo);
      git(repo, 'init', '-q');
      git(repo, 'config', 'user.name', 'Workbook Fixture');
      git(repo, 'config', 'user.email', 'fixture@example.invalid');
      git(repo, 'config', 'commit.gpgsign', 'false');
      git(repo, 'config', 'core.hooksPath', path.join(base, 'no-hooks'));
      for (const file of ['shared.txt', 'a.txt', 'b.txt', 'foreign.txt']) fs.writeFileSync(path.join(repo, file), 'base');
      fs.writeFileSync(path.join(repo, 'verify.mjs'), verifier);
      git(repo, 'add', '.');
      git(repo, 'commit', '-qm', 'fixture base');
      return repo;
    };
    const workbook = (canonicalRoot, checkoutRoot, name, file, expected) => {
      const c = {
        schema_version: 1, contract_revision: 1, project_id: 'fixture', task_id: `work-${crypto.randomUUID()}`,
        title: `Two worker fixture ${name}`, order_label: null,
        home: {repo_id: 'fixture', path: `work-${name}.md`},
        repos: [{repo_id: 'fixture', canonical_root: canonicalRoot, checkout_root: checkoutRoot, write_paths: [file]}],
        baseline_refs: [{ref: 'HEAD', digest: git(checkoutRoot, 'rev-parse', 'HEAD')}], canonical_baseline: null,
        done_condition: 'Exact fixture file passes and commits within its own scope',
        acceptance: [{id: 'A1', repo_id: 'fixture', command: process.execPath,
          args: ['verify.mjs', file, expected], executable_sha256: executableHash,
          entrypoint: 'verify.mjs', entrypoint_sha256: api.digest(verifier),
          source_paths: [file, 'verify.mjs'], artifact_paths: [file]}],
        dependencies: [], budget: {max_wall_time_ms: 30000, max_attempts: 4},
        allowed_actions: ['implement', 'verify', 'commit'], approval_refs: [`fixture-grant:${name}`],
        stop_resume: 'Read this exact fixture workbook and inspect its claim', formal_target: 'fixture'
      };
      const home = path.join(canonicalRoot, c.home.path);
      fs.writeFileSync(home, `<!-- morrowise:workbook:start -->\n\`\`\`json\n${JSON.stringify(c)}\n\`\`\`\n<!-- morrowise:workbook:end -->\n`, {flag: 'wx'});
      return {workbook: api.loadWorkbook(home), name, file};
    };
    const start = async record => {
      const worker = startWorker(copied);
      workers.push(worker);
      const w = record.workbook;
      const result = await worker.rpc('init', {
        home: w.home, work_id: api.workId(w.contract), contract_fingerprint: w.contract_fingerprint,
        allowed_actions: w.contract.allowed_actions, source_ref: w.contract.approval_refs[0],
        session_id: record.name, file: record.file
      });
      assert.notEqual(result.pid, process.pid);
      return worker;
    };
    const barrier = name => { const dir = path.join(base, name); fs.mkdirSync(dir); return dir; };
    const commitGrant = (record, eventId, message) => {
      const w = record.workbook, r = w.contract.repos[0], scope = [record.file];
      return {event_id: eventId, message, operation: {
        repo_id: r.repo_id, ref: git(r.checkout_root, 'symbolic-ref', 'HEAD'),
        base_sha: git(r.checkout_root, 'rev-parse', 'HEAD'), scope_paths: scope, message,
        files: api.fileEvidence(r.checkout_root, scope, {allowMissing: true}),
        diff_fingerprint: api.digest(api.gitRead(r.checkout_root, ['diff', 'HEAD', '--binary', '--', ...scope])),
        verifier_fingerprint: api.digest(w.contract.acceptance)
      }};
    };

    // 1. Same-file admission, distinct homes and UUIDs across linked checkouts.
    const claimsRepo = newRepo('claims');
    const linked = path.join(base, 'claims-linked');
    git(claimsRepo, 'worktree', 'add', '-q', '-b', 'fixture-linked', linked);
    const common = repo => fs.realpathSync(path.resolve(repo, git(repo, 'rev-parse', '--git-common-dir')));
    assert.equal(common(claimsRepo), common(linked));
    assert.notEqual(git(claimsRepo, 'rev-parse', '--absolute-git-dir'), git(linked, 'rev-parse', '--absolute-git-dir'));
    const claimRecords = [workbook(claimsRepo, claimsRepo, 'claim-a', 'shared.txt', 'base'), workbook(claimsRepo, linked, 'claim-b', 'shared.txt', 'base')];
    const claimWorkers = await Promise.all(claimRecords.map(start));
    assert.notEqual(claimWorkers[0].child.pid, claimWorkers[1].child.pid);
    const claimBarriers = [barrier('claim-a-barrier'), barrier('claim-b-barrier')];
    const attempts = claimWorkers.map((worker, i) => worker.rpc('claim', {barrier: claimBarriers[i]}));
    await Promise.all(claimBarriers.map(dir => waitFor(path.join(dir, 'claim.ready'))));
    for (const dir of claimBarriers) release(dir, 'claim');
    const claims = await Promise.all(attempts);
    assert.equal(claims.filter(result => result.decision === 'READY').length, 1, JSON.stringify(claims));
    const winner = claims.findIndex(result => result.decision === 'READY'), loser = 1 - winner;
    assert.ok(['local_lock_held', 'same_file_ownership_conflict'].includes(claims[loser].reason), JSON.stringify(claims));
    const deniedRetry = await claimWorkers[loser].rpc('claim');
    assert.equal(deniedRetry.reason, 'same_file_ownership_conflict', JSON.stringify(deniedRetry));
    const visible = await Promise.all(claimWorkers.map(worker => worker.rpc('inspect')));
    assert.deepEqual(visible[0].claims, visible[1].claims, 'both checkouts see the same common-dir claims');
    const active = visible[0].claims.filter(c => c.state === 'active');
    assert.equal(active.length, 1);
    assert.equal(active[0].session_id, claimRecords[winner].name);
    assert.equal(active[0].home, claimRecords[winner].workbook.home);
    ready(await claimWorkers[winner].rpc('release'));
    for (const worker of claimWorkers) await worker.stop();
    console.log('PASS WF-V05 same-file claim race: two Node PIDs, linked checkouts, one owner, retry cannot steal');

    // 2. Distinct work IDs/home/files in one checkout, each worker owns its edit.
    const repo = newRepo('commits'), initialHead = git(repo, 'rev-parse', 'HEAD');
    const a = workbook(repo, repo, 'commit-a', 'a.txt', 'owned A');
    const b = workbook(repo, repo, 'commit-b', 'b.txt', 'owned B');
    const [wa, wb] = await Promise.all([start(a), start(b)]);
    assert.notEqual(wa.child.pid, wb.child.pid);
    for (const result of await Promise.all([claimWithBusyRetry(wa), claimWithBusyRetry(wb)])) ready(result);
    ready(await wa.rpc('edit', {file: 'a.txt', content: 'owned A'}));
    ready(await wb.rpc('edit', {file: 'b.txt', content: 'owned B', stage: true}));
    fs.writeFileSync(path.join(repo, 'foreign.txt'), 'unrelated staged change');
    git(repo, 'add', '--', 'foreign.txt');
    const staged = file => git(repo, 'ls-files', '--stage', '--', file);
    const bBefore = staged('b.txt'), foreignBefore = staged('foreign.txt');
    const grantA = commitGrant(a, 'fixture-c1-a', 'test: worker A exact change');
    const grantB = commitGrant(b, 'fixture-c1-b', 'test: worker B exact change');
    const verifyA = barrier('verify-a'), verifyB = barrier('verify-b'), holdingA = barrier('holding-a');
    const commitA = wa.rpc('commit', {...grantA, verify_barrier: verifyA, commit_barrier: holdingA});
    const commitB = wb.rpc('commit', {...grantB, verify_barrier: verifyB});
    await Promise.all([waitFor(path.join(verifyA, 'verify.ready')), waitFor(path.join(verifyB, 'verify.ready'))]);
    release(verifyA, 'verify');
    await waitFor(path.join(holdingA, 'commit.ready'));
    const lockPath = path.join(common(repo), 'morrowise-workbooks-v1', 'commit.lock', 'owner.json');
    const lockBefore = fs.readFileSync(lockPath, 'utf8');
    const owner = JSON.parse(lockBefore);
    assert.equal(owner.pid, wa.child.pid);
    assert.equal(owner.session_id, a.name);
    release(verifyB, 'verify');
    const busy = await commitB;
    assert.equal(busy.reason, 'local_lock_held', JSON.stringify(busy));
    assert.equal(fs.readFileSync(lockPath, 'utf8'), lockBefore, 'busy worker must not steal/remove/replace lock');
    assert.equal(staged('b.txt'), bBefore, 'A leaves B staged entry intact');
    assert.equal(staged('foreign.txt'), foreignBefore);
    assert.equal(git(repo, 'rev-list', '--count', `${initialHead}..HEAD`), '1', 'busy B creates no commit');
    release(holdingA, 'commit');
    const resultA = await commitA;
    ready(resultA);
    assert.equal(staged('b.txt'), bBefore);
    assert.equal(staged('foreign.txt'), foreignBefore);
    assert.equal(fs.existsSync(path.dirname(lockPath)), false, 'owner releases its lock normally');
    // A advanced HEAD. Retry requires a fresh exact operation grant from this
    // fixture authority, not reusing the pre-A approval or forcibly taking a lock.
    const staleGrant = await wb.rpc('commit', grantB);
    assert.equal(staleGrant.reason, 'approval_not_verified', JSON.stringify(staleGrant));
    assert.equal(git(repo, 'rev-parse', 'HEAD'), resultA.receipt.c1_sha, 'stale grant creates no commit');
    assert.equal(staged('b.txt'), bBefore, 'stale grant cannot alter B staging');
    assert.equal(staged('foreign.txt'), foreignBefore);
    const resultB = await wb.rpc('commit', commitGrant(b, grantB.event_id, grantB.message));
    ready(resultB);
    assert.equal(resultA.receipt.base_sha, initialHead);
    assert.equal(resultB.receipt.base_sha, resultA.receipt.c1_sha);
    assert.equal(git(repo, 'rev-parse', 'HEAD'), resultB.receipt.c1_sha);
    for (const [result, record] of [[resultA, a], [resultB, b]]) {
      assert.equal(result.receipt.state, 'committed_local');
      assert.equal(result.receipt.pending_delivery, true);
      assert.equal(result.receipt.work_id, api.workId(record.workbook.contract));
      assert.deepEqual(result.receipt.scope_paths, [record.file]);
      assert.equal(git(repo, 'diff-tree', '--no-commit-id', '--name-only', '-r', result.receipt.c1_sha), record.file);
      assert.deepEqual(JSON.parse(git(repo, 'notes', '--ref=refs/notes/morrowise-workbook-v1', 'show', result.receipt.c1_sha)), result.receipt);
    }
    assert.equal(git(repo, 'show', `${resultA.receipt.c1_sha}:a.txt`), 'owned A');
    assert.equal(git(repo, 'show', `${resultA.receipt.c1_sha}:b.txt`), 'base');
    assert.equal(git(repo, 'show', 'HEAD:b.txt'), 'owned B');
    assert.equal(git(repo, 'show', 'HEAD:foreign.txt'), 'base');
    assert.equal(staged('foreign.txt'), foreignBefore, 'both commits preserve unrelated staged bytes');
    assert.equal(git(repo, 'diff', '--cached', '--name-only'), 'foreign.txt');
    assert.equal(git(repo, 'rev-list', '--count', `${initialHead}..HEAD`), '2');
    const repeatA = await wa.rpc('commit', grantA);
    ready(repeatA);
    assert.equal(repeatA.receipt.c1_sha, resultA.receipt.c1_sha);
    assert.equal(git(repo, 'rev-list', '--count', `${initialHead}..HEAD`), '2', 'same event cannot duplicate C1');
    const finalClaims = (await wa.rpc('inspect')).claims.filter(c => c.state === 'active');
    assert.equal(finalClaims.length, 2);
    assert.deepEqual(finalClaims.map(c => c.home).sort(), [a.workbook.home, b.workbook.home].sort());
    assert.deepEqual(finalClaims.map(c => c.session_id).sort(), [a.name, b.name].sort());
    console.log('PASS WF-V05 commit competition: two Node PIDs, busy lock preserved, fresh retry yields exactly two scoped C1s');
    console.log('PASS WF-V05 receipts/index: separate work IDs/homes, Git notes, no mixed files, foreign staged bytes preserved, repeat idempotent');
    console.log(`Fixture helper snapshots: ${JSON.stringify(snapshots)}`);
  } finally {
    await Promise.all(workers.map(worker => worker.stop()));
    fs.rmSync(base, {recursive: true, force: true});
  }
}

if (process.argv[2] === '--fixture-worker') await workerMain(process.argv[3]);
else await run();
