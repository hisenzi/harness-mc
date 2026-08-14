import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync as requireSpawn } from "node:child_process";
import { evaluateJv37Admission } from "./lib/jv37-admission.mjs";
import { applyTaskEvents } from "./apply-task-events.mjs";
import { writeTaskEvent } from "./task-event-outbox.mjs";
import { skipSyncRequest } from "./sync-event-queue.mjs";
import {
  acquireRemoteClaim,
  deriveAuthorizationSnapshot,
  finalizeRemoteCloseout,
  prepareRemoteRelease,
  recordC1Delivery,
  recordPilotObservation,
  recordVerifierEvidence,
  refreshCanonicalMain,
  remoteIdentityHash,
  repoReady,
  runtimeSourceDigest,
  transitionRemoteClaim,
  validatePilotReceipt,
} from "./lib/repo-coordination-runtime.mjs";

const options = parseArgs(process.argv.slice(2));
const tasksPath = path.resolve("milestones/morrowise/tasks.json");
const tasks = JSON.parse(fs.readFileSync(tasksPath, "utf8")).tasks;
const jv37 = tasks.find((task) => task.id === "multi-machine-repo-coordination-gate");
const p3 = tasks.find((task) => task.id === "morrowise-phase3-fresh-session-e2e-admission");
assert.ok(jv37, "JV-37 task missing");
assert.ok(p3, "P3 Final Admission task missing");
assert.ok(p3.dependencies.includes(jv37.id), "P3 must depend on JV-37");
assert.ok(p3.acceptance_matrix.some((row) => row.id === "ADM-P2-02"), "P3 ADM-P2-02 missing");

const fingerprint = `sha256:${crypto.createHash("sha256").update(JSON.stringify(jv37.acceptance_matrix)).digest("hex")}`;

if (options.caseName === "jv37-admission-fixtures") {
  verifyNegativeAdmissionSeam({ jv37, fingerprint });
  verifyCliCannotAcceptSelfReportedReceipt();
  verifySourceBoundFixtureSeam({ jv37, p3, fingerprint });
  console.log(`PASS ADM-P2-02 source-bound fixture seam plus missing, stale, partial and unverified rejection (${fingerprint})`);
} else if (options.receiptPath) {
  const cli = path.resolve("scripts/morrowise-phase3-jv37-admission.mjs");
  const result = spawnNode(cli, ["--receipt", options.receiptPath]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(JSON.parse(result.stdout).decision, "accepted");
  console.log(`PASS ADM-P2-02 current source-verified JV-37 receipt accepted (${fingerprint})`);
} else {
  console.error(`BLOCKED_REAL_ADMISSION ${fingerprint}: provide --receipt <current source-bound JV-37 pilot receipt> after JV37-E2E-06; admission is pinned to this harness-mc checkout and origin.`);
  process.exitCode = 2;
}

function verifyNegativeAdmissionSeam({ jv37, fingerprint }) {
  const base = {
    matrix_fingerprint: fingerprint,
    required_ids: jv37.acceptance_matrix.map((row) => row.id),
    results: jv37.acceptance_matrix.map((row) => ({ id: row.id, status: "pass" })),
  };
  const completedTask = { ...jv37, status: "completed" };
  const fixtures = [
    [null, null, "receipt_missing"],
    [{ ...base, matrix_fingerprint: "sha256:stale" }, { decision: "READY", reason: "real_pilot_receipt_source_verified" }, "matrix_fingerprint_mismatch"],
    [{ ...base, results: base.results.slice(0, -1) }, { decision: "READY", reason: "real_pilot_receipt_source_verified" }, "matrix_results_incomplete"],
    [{ ...base, evidence_kind: "real_multi_session_pilot", source_bound: true }, { decision: "BLOCKED", reason: "source_verification_required" }, "source_verification_required"],
    [{ ...base }, { decision: "BLOCKED", reason: "fixture_only" }, "fixture_only"],
  ];
  for (const [receipt, pilotVerification, reason] of fixtures) {
    const result = evaluateJv37Admission({ jv37Task: completedTask, receipt, currentFingerprint: fingerprint, pilotVerification });
    assert.equal(result.decision, "blocked");
    assert.equal(result.reason, reason);
  }
  const notCompleted = evaluateJv37Admission({
    jv37Task: jv37,
    receipt: base,
    currentFingerprint: fingerprint,
    pilotVerification: { decision: "READY", reason: "real_pilot_receipt_source_verified" },
  });
  assert.equal(notCompleted.reason, "task_not_completed");
}

function verifyCliCannotAcceptSelfReportedReceipt() {
  const tmp = fs.mkdtempSync(path.join("/tmp", "p3-jv37-forged-"));
  const forged = path.join(tmp, "forged.json");
  fs.writeFileSync(forged, `${JSON.stringify({
    producer: "jv37-runtime",
    evidence_kind: "real_multi_session_pilot",
    source_bound: true,
    evidence_refs: ["made-up"],
  }, null, 2)}\n`);
  const result = spawnNode(path.resolve("scripts/morrowise-phase3-jv37-admission.mjs"), [
    "--receipt", forged,
  ]);
  assert.equal(result.status, 2, result.stderr || result.stdout);
  assert.notEqual(JSON.parse(result.stdout).decision, "accepted");

  const alternateRemote = spawnNode(path.resolve("scripts/morrowise-phase3-jv37-admission.mjs"), [
    "--receipt", forged,
    "--remote", "alternate",
  ]);
  assert.notEqual(alternateRemote.status, 0, "production admission must be pinned to canonical origin");
  assert.match(alternateRemote.stderr, /unknown argument: --remote/);
}

function verifySourceBoundFixtureSeam({ jv37, p3, fingerprint }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "p3-jv37-source-bound-"));
  const remote = path.join(tmp, "remote.git");
  git(tmp, ["init", "--bare", remote]);
  const seed = path.join(tmp, "seed");
  git(tmp, ["init", "-b", "main", seed]);
  configure(seed);
  const trust = createFixtureTrust();
  fs.mkdirSync(path.join(seed, "milestones", "morrowise"), { recursive: true });
  fs.mkdirSync(path.join(seed, "system-workflow", "registries"), { recursive: true });
  writeJson(path.join(seed, "milestones", "morrowise", "tasks.json"), { tasks: [jv37, p3] });
  writeJson(path.join(seed, "system-workflow", "registries", "jv37-authorization-approvers.json"), trust.registry);
  fs.writeFileSync(path.join(seed, "README.md"), "seed\n");
  git(seed, ["add", "."]);
  git(seed, ["commit", "-m", "fixture: seed"]);
  git(seed, ["remote", "add", "origin", remote]);
  git(seed, ["push", "-u", "origin", "main"]);
  git(tmp, ["--git-dir", remote, "symbolic-ref", "HEAD", "refs/heads/main"]);

  const clones = ["session-a", "session-b"].map((name) => {
    const target = path.join(tmp, name);
    git(tmp, ["clone", remote, target]);
    configure(target);
    return target;
  });
  const owner = clones[0];
  const refreshed = refreshCanonicalMain({
    repoPath: owner,
    expectedRemoteUrlHash: remoteIdentityHash(owner),
  });
  assert.equal(refreshed.decision, "READY", refreshed.reason);
  assert.equal(refreshCanonicalMain({ repoPath: owner, expectedRemoteUrlHash: "0".repeat(64) }).reason, "wrong_canonical_remote");
  const claim = {
    claim_id: "claim-source-bound",
    task_id: jv37.id,
    project_id: "morrowise",
    repo_class: "shared_core_multi_writer",
    branch: "main",
    base_sha: revParse(owner, "HEAD"),
    claimed_at: "2026-08-12T01:00:00Z",
    owner_role: "integrator",
    actor: "codex",
    session_id: "session-one",
  };
  let claimState = acquireRemoteClaim({ repoPath: owner, claim });
  assert.equal(claimState.decision, "READY");

  fs.writeFileSync(path.join(owner, "c1.txt"), "C1\n");
  git(owner, ["add", "c1.txt"]);
  git(owner, ["commit", "-m", "fixture: C1"]);
  const c1Sha = revParse(owner, "HEAD");
  const delivery = recordC1Delivery({
    repoPath: owner,
    projectId: "morrowise",
    taskId: jv37.id,
    environmentId: "fixture-owner",
    sessionId: "fixture-worker",
    actor: claim.actor,
    baseSha: claim.base_sha,
    commitSha: c1Sha,
    scopePaths: ["c1.txt"],
  });
  assert.equal(delivery.decision, "READY", delivery.reason);
  git(owner, ["push", "origin", "main"]);
  claimState = transitionRemoteClaim({
    repoPath: owner,
    projectId: "morrowise",
    taskId: jv37.id,
    claim,
    nextState: "c1_remote_synced",
    performedBySessionId: "session-one",
    evidence: { c1_sha: c1Sha, delivery_refs: [delivery.ref] },
  });
  assert.equal(claimState.decision, "READY", claimState.reason);
  const authorizationSnapshot = deriveAuthorizationSnapshot({
    repoPath: owner,
    input: {
      commit_scope: ["c1.txt", "c2.txt"],
      grouping: [["c1.txt", "c2.txt"]],
      message: "fixture: JV-37 complete delivery",
      verifiers: [{ id: "jv37-authorization-invariants" }],
      owner: claim.actor,
      human_decision: "approved",
    },
  });
  const authorization = publishAuthorizationApproval(owner, claim, authorizationSnapshot, trust);
  const canonical = transitionRemoteClaim({
    repoPath: owner,
    projectId: "morrowise",
    taskId: jv37.id,
    claim,
    nextState: "canonical_applied",
    performedBySessionId: "session-two",
    evidence: authorization,
  });
  assert.equal(canonical.decision, "READY", canonical.reason);
  writeJson(path.join(owner, "milestones", "morrowise", "state.json"), {
    tasks: { [jv37.id]: { status: "todo", coordination: { active_claim: { ...claim, state: "remote_synced" } } } },
  });
  const completedEvent = {
    type: "task.completed",
    repo: "harness-mc",
    commit: c1Sha,
    project: "morrowise",
    task_id: jv37.id,
    summary: "Canonical completion included in fixture C2",
    actor: claim.actor,
    session_id: "session-two",
    created_at: "2026-08-12T01:09:00Z",
    coordination: {
      ...claim,
      remote_claim_ref: canonical.ref,
      remote_claim_sha: canonical.sha,
      remote_state: "canonical_applied",
    },
  };
  writeTaskEvent({ root: owner, ...completedEvent });
  const completedReport = applyTaskEvents({ root: owner, runGenerateData: false });
  assert.deepEqual(completedReport.applied.map((item) => item.type), ["task.completed"]);
  resolveFixtureSyncEvents(owner);
  claimState = transitionRemoteClaim({
    repoPath: owner,
    projectId: "morrowise",
    taskId: jv37.id,
    claim,
    nextState: "closeout_synced",
    performedBySessionId: "session-two",
  });
  assert.equal(claimState.decision, "READY", claimState.reason);
  claimState = transitionRemoteClaim({
    repoPath: owner,
    projectId: "morrowise",
    taskId: jv37.id,
    claim,
    nextState: "residual_zero",
    performedBySessionId: "session-two",
    evidence: { scope_paths: ["c1.txt", "c2.txt"] },
  });
  assert.equal(claimState.decision, "READY", claimState.reason);
  const prepared = prepareRemoteRelease({
    repoPath: owner,
    projectId: "morrowise",
    taskId: jv37.id,
    claim,
    performedBySessionId: "session-two",
  });
  assert.equal(prepared.decision, "READY", prepared.reason);
  const releaseEvent = {
    type: "task.released",
    repo: "harness-mc",
    project: "morrowise",
    task_id: jv37.id,
    summary: "Prepared release included in fixture C2",
    actor: claim.actor,
    session_id: "session-two",
    created_at: "2026-08-12T01:10:00Z",
    coordination: {
      ...claim,
      remote_claim_ref: prepared.ref,
      remote_claim_sha: prepared.sha,
      remote_state: "released",
      remote_release_prepared: true,
    },
  };
  writeTaskEvent({ root: owner, ...releaseEvent });
  const releaseReport = applyTaskEvents({ root: owner, runGenerateData: false });
  assert.deepEqual(releaseReport.applied.map((item) => item.type), ["task.released"]);
  fs.writeFileSync(path.join(owner, "c2.txt"), "C2\n");
  git(owner, ["add", "c2.txt", "milestones/morrowise/state.json", "task-events/applied", "sync-events/synced"]);
  git(owner, ["commit", "-m", "fixture: C2"]);
  const c2Sha = revParse(owner, "HEAD");
  const finalized = finalizeRemoteCloseout({ repoPath: owner, prepared, c1Sha, c2Sha });
  assert.equal(finalized.decision, "READY", finalized.reason);
  claimState = { ...prepared, sha: finalized.claim_sha, ref: finalized.ref, record: prepared.record };
  const pilotId = "p3-source-bound-fixture";
  const verifier = recordVerifierEvidence({
    repoPath: owner,
    tasksPath: path.join(owner, "milestones", "morrowise", "tasks.json"),
    taskId: jv37.id,
    pilotId,
  });
  assert.equal(verifier.decision, "READY", verifier.reason);
  const sessions = ["session-one", "session-two"];
  const observationOrder = [clones[1], owner];
  const observations = observationOrder.map((clone, index) => {
    const ready = clone === owner
      ? repoReady(clone, {
        autoFf: false,
        exclusions: inspectDirtyPaths(clone),
        commitScope: ["pilot-observation-receipt.json"],
      })
      : repoReady(clone, { autoFf: true });
    assert.equal(ready.decision, "READY", `${ready.reason}: ${ready.details || ""}`);
    const observation = recordPilotObservation({
      repoPath: clone,
      pilotId,
      sessionId: sessions[index],
      environmentId: `fixture-environment-${index + 1}`,
      observedAt: `2026-08-12T01:0${index}:00Z`,
      exclusions: clone === owner ? inspectDirtyPaths(clone) : [],
      fixtureEnvironmentId: `fixture-environment-${index + 1}`,
    });
    assert.equal(observation.decision, "READY", observation.reason);
    return {
      ref: observation.ref,
      sha: observation.sha,
      session_id: sessions[index],
    };
  });
  const receipt = {
    version: 1,
    producer: "jv37-runtime",
    evidence_kind: "simulated_multi_clone_pilot",
    pilot_id: pilotId,
    task_id: jv37.id,
    matrix_fingerprint: fingerprint,
    required_ids: jv37.acceptance_matrix.map((row) => row.id),
    results: jv37.acceptance_matrix.map((row) => ({ id: row.id, status: "pass" })),
    verifier_ref: verifier.ref,
    verifier_sha: verifier.sha,
    session_observations: observations,
    claim_ref: claimState.ref,
    claim_sha: claimState.sha,
    c1_sha: c1Sha,
    c2_sha: c2Sha,
    origin_sha: c2Sha,
    scope_paths: ["c1.txt", "c2.txt"],
  };
  const receiptPath = writeJson(path.join(tmp, "receipt.json"), receipt);
  const pilotVerification = validatePilotReceipt(receipt, {
    repoPath: owner,
    root: owner,
    tasksPath: path.join(owner, "milestones", "morrowise", "tasks.json"),
    allowFixtureAttestations: true,
  });
  assert.equal(pilotVerification.decision, "READY", pilotVerification.reason);
  assert.equal(validatePilotReceipt(receipt, {
    repoPath: owner,
    root: owner,
    tasksPath: path.join(owner, "milestones", "morrowise", "tasks.json"),
  }).reason, "fixture_only", "a one-host three-clone fixture must never satisfy production P3 admission");
  assert.equal(validatePilotReceipt({
    ...receipt,
    session_observations: [observations[0], { ...observations[0] }],
  }, {
    repoPath: owner,
    root: owner,
    tasksPath: path.join(owner, "milestones", "morrowise", "tasks.json"),
    allowFixtureAttestations: true,
  }).reason, "real_pilot_missing", "one repeated session cannot satisfy E2E-06");
  const result = evaluateJv37Admission({
    jv37Task: { ...jv37, status: "completed" },
    receipt,
    currentFingerprint: fingerprint,
    pilotVerification,
  });
  assert.equal(result.decision, "accepted");

  const forged = writeJson(path.join(tmp, "receipt-forged.json"), {
    ...receipt,
    verifier_sha: "f".repeat(40),
  });
  const forgedReceipt = JSON.parse(fs.readFileSync(forged, "utf8"));
  assert.equal(validatePilotReceipt(forgedReceipt, {
    repoPath: owner,
    root: owner,
    tasksPath: path.join(owner, "milestones", "morrowise", "tasks.json"),
    allowFixtureAttestations: true,
  }).reason, "verifier_evidence_not_remote_bound");
}

function parseArgs(argv) {
  const options = { receiptPath: null, caseName: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--receipt") options.receiptPath = path.resolve(argv[++index] || "");
    else if (argv[index] === "--case") options.caseName = argv[++index] || null;
    else throw new Error(`unknown argument: ${argv[index]}`);
  }
  return options;
}

function spawnNode(script, args) {
  return requireSpawn(process.execPath, [script, ...args], { encoding: "utf8" });
}

function configure(repo) {
  git(repo, ["config", "user.email", "fixture@example.invalid"]);
  git(repo, ["config", "user.name", "JV37 Fixture"]);
}

function createFixtureTrust() {
  const approver = crypto.generateKeyPairSync("ed25519");
  return {
    approver,
    registry: {
      version: 1,
      authorization_approvers: [{
        approver_id: "vincent-fixture",
        key_id: "fixture-approver-key",
        public_key_pem: approver.publicKey.export({ type: "spki", format: "pem" }),
        status: "active",
      }],
    },
  };
}

function publishAuthorizationApproval(repo, claim, snapshot, trust) {
  const approvalId = "fixture-p3-approval";
  const unsigned = {
    version: 1,
    producer: "jv37-trusted-authorization-signer",
    evidence_kind: "signed_human_authorization",
    approval_id: approvalId,
    approver_id: "vincent-fixture",
    key_id: "fixture-approver-key",
    project_id: claim.project_id,
    task_id: claim.task_id,
    claim_id: claim.claim_id,
    snapshot,
    verifier_results: [{
      id: "jv37-authorization-invariants",
      status: "pass",
      runtime_source_digest: runtimeSourceDigest(),
    }],
    remote_url_hash: remoteIdentityHash(repo),
    approved_at: "2026-08-12T01:05:00Z",
  };
  const record = signRecord(unsigned, trust.approver.privateKey);
  const ref = `refs/jv37/approvals/${claim.project_id}/${claim.task_id}/${approvalId}`;
  const sha = publishFixtureRecord(repo, ref, "approval.json", record);
  return {
    authorization_approval_ref: ref,
    authorization_approval_sha: sha,
    authorization_current: { ...snapshot },
  };
}

function signRecord(unsigned, privateKey) {
  const signature = crypto.sign(null, Buffer.from(canonicalJson(unsigned)), privateKey).toString("base64");
  return { ...unsigned, signature: `base64:${signature}` };
}

function publishFixtureRecord(repo, ref, fileName, record) {
  const blob = git(repo, ["hash-object", "-w", "--stdin"], { input: `${JSON.stringify(record, null, 2)}\n` });
  const tree = git(repo, ["mktree"], { input: `100644 blob ${blob.stdout.trim()}\t${fileName}\n` });
  const commit = git(repo, ["commit-tree", tree.stdout.trim(), "-m", `fixture: ${fileName}`]);
  git(repo, ["push", "origin", `${commit.stdout.trim()}:${ref}`]);
  return commit.stdout.trim();
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function git(cwd, args, options = {}) {
  const result = requireSpawn("git", args, { cwd, encoding: "utf8", input: options.input });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result;
}

function revParse(cwd, ref) {
  return git(cwd, ["rev-parse", ref]).stdout.trim();
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  return filePath;
}

function inspectDirtyPaths(repo) {
  const output = git(repo, ["status", "--porcelain=v2", "--branch"]).stdout;
  return output.split("\n").filter((line) => line && !line.startsWith("# ")).flatMap((line) => {
    if (line.startsWith("? ")) return [line.slice(2)];
    if (line.startsWith("2 ")) {
      const [current, original] = line.split("\t");
      return [current.split(" ").at(-1), original];
    }
    return [line.split(" ").at(-1)];
  }).filter(Boolean);
}

function resolveFixtureSyncEvents(repo) {
  const pendingDir = path.join(repo, "sync-events", "pending");
  if (!fs.existsSync(pendingDir)) return;
  for (const fileName of fs.readdirSync(pendingDir).filter((name) => name.endsWith(".json"))) {
    const event = JSON.parse(fs.readFileSync(path.join(pendingDir, fileName), "utf8"));
    skipSyncRequest({
      root: repo,
      sync_event_id: event.sync_event_id,
      exemption_reason: "P3 source-bound fixture has no external sync target",
      verifier: "verify-morrowise-phase3-jv37-admission",
      actor: "jv37-fixture",
      session_id: "session-two",
      resolved_at: "2026-08-12T01:09:30Z",
    });
  }
}
