#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as core from './lib/release-tracking.mjs';

const SCRIPT = fileURLToPath(import.meta.url);
const CORE_ROOT = path.resolve(path.dirname(SCRIPT), '..');
const MANIFEST = 'bundle-manifest.json';
const REQUIRED_FILES = ['source-event.json', 'input/event.json', 'input/contract.json', 'input/result.json', 'input/evidence/stdout.log', 'input/evidence/stderr.log', 'plan/plan.json', 'plan/message.md'];
const CORE_FILES = ['scripts/release-tracking-actions.mjs', 'scripts/release-tracking.mjs', 'scripts/lib/release-tracking.mjs', 'scripts/verify-release-tracking.mjs', 'system-workflow/fixtures/release-tracking/contract.json', 'system-workflow/fixtures/release-tracking/cases.json', 'system-workflow/fixtures/release-tracking/project-contract.template.json'];

function fail(message, exitCode = 2) { throw Object.assign(new Error(message), { exitCode }); }
function json(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function hash(file) { return core.computeSha256(fs.readFileSync(file)); }
function git(checkoutDir, ...args) {
  try { return execFileSync('git', ['-C', checkoutDir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  catch { fail(`Cannot verify checkout Git object (${args[0]})`); }
}
function requireNew(outDir) { if (fs.existsSync(outDir)) fail(`Output directory already exists: ${outDir}`); }
function safeFile(root, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || path.isAbsolute(relative) || relative.split('/').some(part => !part || part === '.' || part === '..')) fail(`Unsafe bundle path: ${relative}`);
  const resolved = path.resolve(root, relative);
  const rootPath = path.resolve(root);
  if (!resolved.startsWith(`${rootPath}${path.sep}`)) fail(`Bundle path escapes root: ${relative}`);
  let cursor = rootPath;
  for (const part of relative.split('/')) {
    cursor = path.join(cursor, part);
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) fail(`Bundle symlink rejected: ${relative}`);
  }
  return resolved;
}
function listFiles(root, prefix = '') {
  const files = [];
  for (const entry of fs.readdirSync(path.join(root, prefix), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) fail(`Bundle symlink rejected: ${relative}`);
    if (entry.isDirectory()) files.push(...listFiles(root, relative));
    else if (entry.isFile()) { if (relative !== MANIFEST) files.push(relative); }
    else fail(`Unsupported bundle file: ${relative}`);
  }
  return files;
}
function sealBundle(root, metadata) {
  const files = Object.fromEntries(listFiles(root).map(relative => [relative, hash(safeFile(root, relative))]));
  writeJson(path.join(root, MANIFEST), { schema_version: 1, ...metadata, files });
  return verifyBundle(root);
}

function normalizeEvent({ event, env = process.env, checkoutDir, activation }, archivedCapture = null) {
  if (env.GITHUB_EVENT_NAME !== 'push' || event?.deleted === true) fail('Only a non-deleted GitHub tag push can capture live pilot materials');
  if (!/^refs\/tags\/v0\.0\.0-issue2-test-[0-9A-Za-z.-]+$/.test(event?.ref || '')) fail('Event ref is outside the explicit issue2-test tag prefix');
  if (env.GITHUB_REF !== event.ref) fail('Actions ref differs from the original event ref');
  if (!/^[^/\s]+\/[^/\s]+$/.test(env.GITHUB_REPOSITORY || '') || event.repository?.full_name !== env.GITHUB_REPOSITORY) fail('Actions repository differs from the original event repo');
  if (!/^[0-9a-f]{40}$/i.test(env.GITHUB_SHA || '')) fail('GITHUB_SHA must be a full 40-character commit SHA');
  if (git(checkoutDir, 'rev-parse', 'HEAD') !== env.GITHUB_SHA || git(checkoutDir, 'cat-file', '-t', env.GITHUB_SHA) !== 'commit') fail('Actual checkout HEAD does not match the event commit SHA');
  if (!/^[0-9a-f]{40}$/i.test(event.after || '') || /^0+$/.test(event.after)) fail('Original event after must identify a real Git object');
  if (archivedCapture) {
    // A moved annotated tag can leave its original object absent from a fresh clone.
    // Reuse the verified capture's object-to-commit binding, while checking this
    // invocation's original event and actual checkout independently.
    const { source, manifest } = archivedCapture;
    if (source.after !== event.after || source.ref !== event.ref || source.repository?.full_name !== env.GITHUB_REPOSITORY || source.github_sha !== env.GITHUB_SHA || String(source.run_id) !== env.GITHUB_RUN_ID || manifest.commit_sha !== source.github_sha || manifest.repo !== source.repository.full_name || manifest.tag !== source.ref.slice('refs/tags/'.length) || String(manifest.run_id) !== String(source.run_id)) fail('Archived source event and manifest do not match the triggering event/SHA', 3);
  } else {
    // First capture must prove the immutable object-to-commit binding by peeling.
    if (git(checkoutDir, 'rev-parse', `${event.after}^{commit}`) !== env.GITHUB_SHA) fail('Original event object does not peel to the checked-out commit SHA');
  }
  if (!/^\d+$/.test(env.GITHUB_RUN_ID || '')) fail('A real GitHub Actions run ID is required');
  const timestamp = event.head_commit?.timestamp;
  const normalized = {
    schema_version: 1,
    event_id: `github-actions:${env.GITHUB_RUN_ID}`,
    event_type: 'tag_push', repo: env.GITHUB_REPOSITORY, ref: event.ref,
    tag: event.ref.slice('refs/tags/'.length), commit_sha: env.GITHUB_SHA,
    observed_at: timestamp && Number.isFinite(Date.parse(timestamp)) ? new Date(timestamp).toISOString() : new Date().toISOString(),
    deleted: false, fixture: true,
    routing: { mode: 'existing', target: activation?.target },
  };
  core.validateActivation(activation, { event: normalized, action: 'existing', routing: normalized.routing });
  return normalized;
}

export function normalizeActionsEvent(args) { return normalizeEvent(args); }

export function verifyBundle(bundleDir) {
  const root = path.resolve(bundleDir);
  if (fs.lstatSync(root).isSymbolicLink()) fail('Bundle root must not be a symlink');
  const manifestPath = safeFile(root, MANIFEST);
  const manifest = json(manifestPath);
  if (manifest.schema_version !== 1 || !manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files)) fail('Invalid bundle manifest');
  for (const [relative, expected] of Object.entries(manifest.files)) {
    const file = safeFile(root, relative);
    if (relative === MANIFEST || !/^[0-9a-f]{64}$/.test(expected) || !fs.existsSync(file) || !fs.statSync(file).isFile()) fail(`Invalid manifest file or hash: ${relative}`);
    if (hash(file) !== expected) fail(`Bundle hash mismatch: ${relative}`);
  }
  for (const relative of listFiles(root)) if (!Object.hasOwn(manifest.files, relative)) fail(`Undeclared bundle file: ${relative}`);
  for (const relative of REQUIRED_FILES) if (!Object.hasOwn(manifest.files, relative)) fail(`Missing required manifest file: ${relative}`);
  return manifest;
}

export async function captureBundle({ event, env = process.env, activation, checkoutDir, outDir }) {
  const out = path.resolve(outDir);
  requireNew(out);
  const normalized = normalizeActionsEvent({ event, env, checkoutDir, activation });
  if (String(env.GITHUB_RUN_ATTEMPT || '1') !== '1') fail('Reruns must restore the original bundle instead of capturing new results', 3);
  const input = path.join(out, 'input');
  fs.mkdirSync(path.join(input, 'evidence'), { recursive: true });
  writeJson(path.join(input, 'event.json'), normalized);
  writeJson(path.join(out, 'source-event.json'), { ref: event.ref, after: event.after, before: event.before, created: event.created, deleted: event.deleted, forced: event.forced, repository: { full_name: event.repository.full_name }, github_sha: env.GITHUB_SHA, run_id: env.GITHUB_RUN_ID });
  const contract = { schema_version: 1, contract_version: '1', project_id: 'release-tracking-actions-synthetic-pipeline', required_cases: ['RT-PIPELINE'], cases: [{ id: 'RT-PIPELINE', required: true, name: 'Synthetic release-tracking pipeline verification (RT01–RT15)' }] };
  const contractPath = path.join(input, 'contract.json');
  writeJson(contractPath, contract);
  const verifyOutput = `${out}-verification`;
  requireNew(verifyOutput);
  const command = [process.execPath, path.join(CORE_ROOT, 'scripts/verify-release-tracking.mjs'), '--out', verifyOutput];
  const childEnv = { ...process.env, TZ: 'UTC' };
  delete childEnv.GITHUB_TOKEN;
  delete childEnv.GH_TOKEN;
  const started = new Date();
  const monotonicStart = performance.now();
  const child = spawnSync(command[0], command.slice(1), { cwd: CORE_ROOT, env: childEnv, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 120_000 });
  fs.writeFileSync(path.join(input, 'evidence/stdout.log'), child.stdout || '');
  fs.writeFileSync(path.join(input, 'evidence/stderr.log'), child.stderr || '');
  if (!Number.isInteger(child.status)) fail(`Verifier did not return an exit code (${child.signal || child.error?.code || 'unknown'}); evidence preserved`, 3);
  const evidencePaths = ['evidence/stdout.log', 'evidence/stderr.log'];
  if (fs.existsSync(path.join(verifyOutput, 'results.json'))) {
    fs.copyFileSync(path.join(verifyOutput, 'results.json'), path.join(input, 'evidence/results.json'));
    evidencePaths.push('evidence/results.json');
  }
  const result = {
    schema_version: 1, contract_sha256: hash(contractPath), source_commit: normalized.commit_sha,
    environment: { os: process.platform, arch: process.arch, node: process.version, git: git(checkoutDir, '--version'), fixture: true },
    ci: { kind: 'github_actions', url: `https://github.com/${normalized.repo}/actions/runs/${env.GITHUB_RUN_ID}` },
    cases: [{ id: 'RT-PIPELINE', status: child.status === 0 ? 'PASS' : 'FAIL', command: command.map(arg => `'${arg.replaceAll("'", "'\\''")}'`).join(' '), argv: command, exit_code: child.status, started_at: started.toISOString(), duration_ms: Math.round(performance.now() - monotonicStart), evidence: evidencePaths.map(relative => ({ path: relative, sha256: hash(path.join(input, relative)) })) }],
  };
  writeJson(path.join(input, 'result.json'), result);
  core.executePlan({ eventPath: path.join(input, 'event.json'), contractPath, resultPath: path.join(input, 'result.json'), evidenceRoot: input, outDir: path.join(out, 'plan') });
  const sources = Object.fromEntries(CORE_FILES.map(relative => [relative, hash(path.join(CORE_ROOT, relative))]));
  return sealBundle(out, { repo: normalized.repo, tag: normalized.tag, commit_sha: normalized.commit_sha, run_id: env.GITHUB_RUN_ID, core_checkout_commit: git(CORE_ROOT, 'rev-parse', 'HEAD'), core_sources: sources, activation_sha256: core.computeSha256(JSON.stringify(activation)), fixture: true });
}

export function restoreBundle({ bundleDir, outDir, event, env = process.env, checkoutDir, activation }) {
  const out = path.resolve(outDir);
  requireNew(out);
  const manifest = verifyBundle(bundleDir);
  const normalized = normalizeEvent({ event, env, checkoutDir, activation }, { manifest, source: json(path.join(bundleDir, 'source-event.json')) });
  const originalEvent = json(path.join(bundleDir, 'input/event.json'));
  for (const key of ['repo', 'ref', 'tag', 'commit_sha', 'event_id']) if (originalEvent[key] !== normalized[key]) fail(`Original bundle event ${key} differs from the triggering event`, 3);
  if (String(manifest.run_id) !== env.GITHUB_RUN_ID) fail('Original bundle run ID differs from this rerun', 3);
  if (!manifest.core_sources || CORE_FILES.some(relative => manifest.core_sources[relative] !== hash(path.join(CORE_ROOT, relative)))) fail('Core source hashes differ from the original bundle', 3);
  for (const relative of Object.keys(manifest.files)) {
    const target = safeFile(out, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(safeFile(bundleDir, relative), target);
  }
  const planPath = path.join(out, 'plan/plan.json');
  const plan = json(planPath);
  const originalPaths = plan.material_paths;
  plan.material_paths = { event: path.join(out, 'input/event.json'), contract: path.join(out, 'input/contract.json'), result: path.join(out, 'input/result.json'), evidence_root: path.join(out, 'input') };
  writeJson(planPath, plan);
  writeJson(path.join(out, 'replay.json'), { original_manifest_sha256: hash(path.join(bundleDir, MANIFEST)), original_plan_sha256: manifest.files['plan/plan.json'], relocated_plan_sha256: hash(planPath), body_sha256: manifest.files['plan/message.md'], previous_material_paths: originalPaths, relocated_material_paths: plan.material_paths, run_attempt: env.GITHUB_RUN_ATTEMPT || '1' });
  const { files: ignored, ...metadata } = manifest;
  return sealBundle(out, metadata);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (!rest[i].startsWith('--') || !rest[i + 1] || rest[i + 1].startsWith('--')) fail(`Invalid option: ${rest[i]}`);
    const key = rest[i].slice(2);
    if (!['event', 'activation', 'checkout', 'out', 'bundle'].includes(key) || Object.hasOwn(options, key)) fail(`Unknown or duplicate option: ${rest[i]}`);
    options[key] = rest[i + 1];
  }
  return { command, options };
}
async function main(argv) {
  if (argv.length === 0 || argv.includes('--help')) {
    console.log('Usage:\n  node scripts/release-tracking-actions.mjs capture --event <github-event.json> --activation <activation.json> --checkout <event-checkout> --out <new-bundle>\n  node scripts/release-tracking-actions.mjs restore --bundle <original-bundle> --event <github-event.json> --activation <activation.json> --checkout <event-checkout> --out <new-bundle>\n  node scripts/release-tracking-actions.mjs verify --bundle <bundle>');
    return;
  }
  const { command, options } = parseArgs(argv);
  if (command === 'verify') {
    if (!options.bundle) fail('verify requires --bundle');
    verifyBundle(options.bundle);
  } else if (command === 'capture' || command === 'restore') {
    for (const key of ['event', 'activation', 'checkout', 'out', ...(command === 'restore' ? ['bundle'] : [])]) if (!options[key]) fail(`${command} requires --${key}`);
    const args = { event: json(options.event), activation: json(options.activation), checkoutDir: path.resolve(options.checkout), outDir: path.resolve(options.out) };
    if (command === 'capture') await captureBundle(args);
    else restoreBundle({ ...args, bundleDir: path.resolve(options.bundle) });
  } else fail(`Unknown command: ${command}`);
  console.log(`${command}: immutable release-tracking materials verified`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = error.exitCode || 2; });
