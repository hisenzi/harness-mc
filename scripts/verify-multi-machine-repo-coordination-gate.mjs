import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { applyTaskEvents } from "./apply-task-events.mjs";
import { skipSyncRequest } from "./sync-event-queue.mjs";
import { writeTaskEvent } from "./task-event-outbox.mjs";
import {
  acquireRemoteClaim,
  authorizeCanonicalApply,
  deriveAuthorizationSnapshot,
  classifyRepoSnapshot,
  inspectAuthorizationContinuation,
  inspectC2CloseoutTree,
  inspectCloseoutState,
  inspectC1Delivery,
  inspectRemoteCoordination,
  inspectRepo,
  inspectTerminalCloseout,
  finalizeRemoteCloseout,
  prepareRemoteRelease,
  preparePilotObservation,
  recordC1Delivery,
  recordPilotObservation,
  repoReady,
  remoteIdentityHash,
  runtimeSourceDigest,
  integrateC1Deliveries,
  transitionRemoteClaim,
} from "./lib/repo-coordination-runtime.mjs";

const fixtureTrustByRepo = new Map();
let fixtureApprovalSequence = 0;

const cases = new Map([
  ["device-free-identity-contract", verifyDeviceFreeIdentityContract],
  ["concurrent-delivery-single-integrator", verifyConcurrentDeliverySingleIntegrator],
  ["crash-recovery-fresh-session", verifyCrashRecoveryFreshSession],
  ["authorization-continuation", verifyAuthorizationContinuation],
  ["remote-terminal-closeout", verifyRemoteTerminalCloseout],
  ["multi-clone-negative-fixtures", verifyMultiCloneNegativeFixtures],
  ["runtime-cli", verifyRuntimeCli],
  ["real-multi-session-pilot", verifyRealMultiSessionPilot],
]);

const options = parseArgs(process.argv.slice(2));
const localCases = [...cases.keys()].filter((name) => name !== "real-multi-session-pilot");
const selected = options.caseName === "all-local" ? localCases : options.caseName ? [options.caseName] : localCases;

for (const caseName of selected) {
  const verifier = cases.get(caseName);
  if (!verifier) throw new Error(`unknown case: ${caseName}`);
  await verifier(options);
  console.log(`PASS ${caseName}`);
}

if (!options.caseName) {
  console.error("BLOCKED real_pilot_receipt_missing: local JV37-E2E-01..05 passed, but JV37-E2E-06 requires --case real-multi-session-pilot --receipt <source-bound JSON> --repo <live-clone>.");
  process.exitCode = 2;
} else if (options.caseName === "all-local") {
  console.log("LOCAL_JV37_E2E01_05_PASS: this is not full JV-37 acceptance; JV37-E2E-06 remains a real multi-session blocker.");
}

function verifyDeviceFreeIdentityContract() {
  const fixture = createFixture("jv37-device-free-identity");
  const repo = fixture.clones.sessionA;
  const claim = {
    claim_id: "claim-device-free",
    task_id: "jv37",
    project_id: "morrowise",
    repo_class: "shared_core_multi_writer",
    branch: "main",
    base_sha: revParse(repo, "HEAD"),
    claimed_at: "2026-08-14T00:00:00Z",
    owner_role: "integrator",
    actor: "vincent-github",
    session_id: "fresh-session-a",
  };
  assert.equal(acquireRemoteClaim({ repoPath: repo, claim }).decision, "READY");
  const prepared = preparePilotObservation({
    repoPath: repo,
    pilotId: "pilot-device-free",
    sessionId: "fresh-session-a",
    environmentId: "portable-environment",
    commitScope: ["pilot-observation-receipt.json"],
  });
  assert.equal(prepared.decision, "READY", prepared.reason);
  assert.equal(prepared.record.environment_id, "portable-environment");
  assert.equal(Object.hasOwn(prepared.record, "machine_id"), false);
}

async function verifyConcurrentDeliverySingleIntegrator() {
  const fixture = createFixture("jv37-claim-race");
  const runtimePath = fileURLToPath(new URL("./repo-coordination-runtime.mjs", import.meta.url));
  const baseSha = revParse(fixture.clones.sessionA, "HEAD");
  fs.writeFileSync(path.join(fixture.clones.sessionA, "worker-a.txt"), "worker A\n");
  git(fixture.clones.sessionA, ["add", "worker-a.txt"]);
  git(fixture.clones.sessionA, ["commit", "-m", "test: worker A C1"]);
  const c1A = revParse(fixture.clones.sessionA, "HEAD");
  fs.writeFileSync(path.join(fixture.clones.sessionB, "worker-b.txt"), "worker B\n");
  git(fixture.clones.sessionB, ["add", "worker-b.txt"]);
  git(fixture.clones.sessionB, ["commit", "-m", "test: worker B C1"]);
  const c1B = revParse(fixture.clones.sessionB, "HEAD");
  const deliveryA = recordC1Delivery({
    repoPath: fixture.clones.sessionA,
    projectId: "morrowise",
    taskId: "jv37",
    environmentId: "fixture-a",
    sessionId: "worker-session-a",
    actor: "worker-a",
    baseSha,
    commitSha: c1A,
    scopePaths: ["worker-a.txt"],
  });
  const deliveryB = recordC1Delivery({
    repoPath: fixture.clones.sessionB,
    projectId: "morrowise",
    taskId: "jv37",
    environmentId: "fixture-b",
    sessionId: "worker-session-b",
    actor: "worker-b",
    baseSha,
    commitSha: c1B,
    scopePaths: ["worker-b.txt"],
  });
  assert.equal(deliveryA.decision, "READY", deliveryA.reason);
  assert.equal(deliveryB.decision, "READY", deliveryB.reason);
  assert.notEqual(deliveryA.ref, deliveryB.ref);
  const claimA = makeClaim("session-a", baseSha, "claim-a");
  const claimB = makeClaim("session-b", baseSha, "claim-b");
  const aPath = writeJson(path.join(fixture.tmp, "claim-a.json"), claimA);
  const bPath = writeJson(path.join(fixture.tmp, "claim-b.json"), claimB);
  const [a, b] = await Promise.all([
    runAsync(process.execPath, [runtimePath, "remote-claim", "--repo", fixture.clones.sessionA, "--input", aPath]),
    runAsync(process.execPath, [runtimePath, "remote-claim", "--repo", fixture.clones.sessionB, "--input", bPath]),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [0, 2], `${a.stderr}\n${b.stderr}`);
  const winnerResult = JSON.parse((a.status === 0 ? a : b).stdout);
  const winnerClaim = a.status === 0 ? claimA : claimB;
  const winnerClone = a.status === 0 ? fixture.clones.sessionA : fixture.clones.sessionB;
  const loserClaim = a.status === 0 ? claimB : claimA;
  const observed = inspectRemoteCoordination({ repoPath: fixture.clones.sessionC, ref: winnerResult.ref });
  assert.equal(observed.decision, "READY");
  assert.equal(observed.sha, winnerResult.sha);
  assert.equal(observed.record.claim_id, winnerClaim.claim_id);

  const integrated = integrateC1Deliveries({
    repoPath: winnerClone,
    claim: winnerClaim,
    deliveries: [deliveryA, deliveryB],
  });
  assert.equal(integrated.decision, "READY", integrated.reason);
  assert.deepEqual(new Set(integrated.applied_commits), new Set([c1A, c1B]));
  assert.equal(fs.readFileSync(path.join(winnerClone, "worker-a.txt"), "utf8"), "worker A\n");
  assert.equal(fs.readFileSync(path.join(winnerClone, "worker-b.txt"), "utf8"), "worker B\n");

  const unclaimed = createFixture("jv37-unclaimed-completion");
  writeTaskEvent({
    root: unclaimed.clones.sessionA,
    type: "task.completed",
    repo: "harness-mc",
    commit: revParse(unclaimed.clones.sessionA, "HEAD"),
    project: "morrowise",
    task_id: "jv37",
    summary: "Worker must not bypass a missing claim.",
    actor: "worker-agent",
    session_id: "worker-session",
    created_at: "2026-08-12T00:59:00Z",
  });
  const unclaimedReport = applyTaskEvents({ root: unclaimed.clones.sessionA, runGenerateData: false });
  assert.equal(unclaimedReport.applied.length, 0);
  assert.equal(unclaimedReport.rejected[0].reason, "claim_missing");

  const claimEvent = coordinationEvent("task.claimed", winnerClaim, winnerResult, { commit: null });
  writeTaskEvent({ root: winnerClone, ...claimEvent });
  const applied = applyTaskEvents({ root: winnerClone, runGenerateData: false });
  assert.deepEqual(applied.applied.map((item) => item.type), ["task.claimed"]);

  const forgedWorker = coordinationEvent("task.completed", {
    ...winnerClaim,
    actor: "worker-agent",
    session_id: loserClaim.session_id,
  }, { ...winnerResult, record: { ...winnerResult.record, state: "claimed" } }, { commit: baseSha });
  writeTaskEvent({ root: winnerClone, ...forgedWorker, event_id: "worker-cannot-complete" });
  const rejected = applyTaskEvents({ root: winnerClone, runGenerateData: false });
  assert.equal(rejected.applied.length, 0);
  assert.equal(rejected.rejected[0].reason, "claim_owner_mismatch");

  completeConcurrentDeliveryCloseout({ fixture, repo: winnerClone, claim: winnerClaim, deliveries: [deliveryA, deliveryB] });
  assert.equal(inspectC1Delivery({ repoPath: fixture.clones.sessionC, ref: deliveryA.ref }).record.commit_sha, c1A);
  assert.equal(inspectC1Delivery({ repoPath: fixture.clones.sessionC, ref: deliveryB.ref }).record.commit_sha, c1B);
}

async function verifyCrashRecoveryFreshSession() {
  const fixture = createFixture("jv37-recovery");
  const repo = fixture.clones.sessionA;
  const claim = makeClaim("session-recovery", revParse(repo, "HEAD"), "claim-recovery");
  const acquired = acquireRemoteClaim({ repoPath: repo, claim });
  assert.equal(acquired.decision, "READY");
  assert.equal(transitionRemoteClaim({
    repoPath: repo,
    projectId: claim.project_id,
    taskId: claim.task_id,
    claim,
    nextState: "released",
  }).reason, "atomic_closeout_required");
  assert.equal(inspectCloseoutState(closeoutOptions(fixture, repo)).action, "apply_claim_event");
  assert.equal(inspectCloseoutState(closeoutOptions(fixture, repo)).action, "apply_claim_event", "fresh read must be deterministic");

  writeTaskEvent({ root: repo, ...coordinationEvent("task.claimed", claim, acquired, { commit: null }) });
  assert.deepEqual(applyTaskEvents({ root: repo, runGenerateData: false }).applied.map((item) => item.type), ["task.claimed"]);
  assert.equal(inspectCloseoutState(closeoutOptions(fixture, repo)).action, "create_and_deliver_c1");
  fs.writeFileSync(path.join(repo, "recovery-c1.txt"), "C1\n");
  git(repo, ["add", "recovery-c1.txt"]);
  git(repo, ["commit", "-m", "test: recovery C1"]);
  const c1Sha = revParse(repo, "HEAD");
  const delivery = recordC1Delivery({
    repoPath: repo,
    projectId: claim.project_id,
    taskId: claim.task_id,
    environmentId: "fixture-recovery",
    sessionId: "recovery-worker",
    actor: claim.actor,
    baseSha: claim.base_sha,
    commitSha: c1Sha,
    scopePaths: ["recovery-c1.txt"],
  });
  assert.equal(delivery.decision, "READY", delivery.reason);
  assert.equal(inspectCloseoutState(closeoutOptions(fixture, repo)).action, "push_c1");
  git(repo, ["push", "origin", "main"]);
  assert.equal(inspectCloseoutState(closeoutOptions(fixture, repo)).action, "record_c1_remote_synced");
  assert.equal(transitionRemoteClaim({
    repoPath: repo,
    projectId: claim.project_id,
    taskId: claim.task_id,
    claim,
    nextState: "c1_remote_synced",
  }).reason, "c1_delivery_proof_missing");
  let transition = transitionRemoteClaim({
    repoPath: repo,
    projectId: claim.project_id,
    taskId: claim.task_id,
    claim,
    nextState: "c1_remote_synced",
    evidence: { c1_sha: c1Sha, delivery_refs: [delivery.ref] },
  });
  assert.equal(transition.decision, "READY", `${transition.reason}: ${transition.details || ""}`);
  assert.equal(inspectCloseoutState(closeoutOptions(fixture, repo)).action, "apply_remote_synced_event");

  writeTaskEvent({ root: repo, ...coordinationEvent("task.remote_synced", claim, transition, { commit: c1Sha }) });
  assert.deepEqual(applyTaskEvents({ root: repo, runGenerateData: false }).applied.map((item) => item.type), ["task.remote_synced"]);
  assert.equal(inspectCloseoutState(closeoutOptions(fixture, repo)).action, "authorize_canonical_apply");
  const approved = authorizationReceipt(repo, c1Sha);
  const continuation = inspectAuthorizationContinuation({ repoPath: repo, approved, current: { ...approved } });
  assert.equal(continuation.decision, "READY", continuation.reason);
  assert.equal(transitionRemoteClaim({
    repoPath: repo,
    projectId: claim.project_id,
    taskId: claim.task_id,
    claim,
    nextState: "canonical_applied",
    evidence: { authorization_proof: { reason: "authorization_invariants_unchanged", approved_fingerprint: "same", current_fingerprint: "same" } },
  }).reason, "authorization_approval_ref_missing");
  transition = transitionRemoteClaim({
    repoPath: repo,
    projectId: claim.project_id,
    taskId: claim.task_id,
    claim,
    nextState: "canonical_applied",
    evidence: authorizationEvidence(repo, claim, approved),
  });
  assert.equal(transition.decision, "READY", `${transition.reason}: ${transition.details || ""}`);
  assert.equal(inspectCloseoutState(closeoutOptions(fixture, repo)).action, "apply_task_completed_event");

  applyCanonicalCompletionEvent(repo, claim, transition);
  assert.equal(inspectCloseoutState(closeoutOptions(fixture, repo)).action, "closeout_sync");
  assert.equal(transitionRemoteClaim({
    repoPath: repo,
    projectId: claim.project_id,
    taskId: claim.task_id,
    claim,
    nextState: "closeout_synced",
  }).reason, "sync_event_pending");
  resolveFixtureSyncEvents(repo, "fresh-session-recovery");
  transitionState(repo, claim, "closeout_synced");
  assert.equal(inspectCloseoutState(closeoutOptions(fixture, repo)).action, "verify_residual_zero");
  assert.equal(transitionRemoteClaim({
    repoPath: repo,
    projectId: claim.project_id,
    taskId: claim.task_id,
    claim,
    nextState: "residual_zero",
  }).reason, "residual_scope_missing");
  transitionState(repo, claim, "residual_zero", { scope_paths: ["recovery-c1.txt", "c2.txt"] });
  assert.equal(inspectCloseoutState(closeoutOptions(fixture, repo)).action, "create_c2_with_release_event");
  const prepared = prepareRemoteRelease({ repoPath: repo, projectId: claim.project_id, taskId: claim.task_id, claim, performedBySessionId: "fresh-session-recovery" });
  assert.equal(prepared.decision, "READY");
  applyPreparedReleaseEvent(repo, claim, prepared);
  fs.writeFileSync(path.join(repo, "c2.txt"), "C2\n");
  git(repo, ["add", "c2.txt", "milestones/morrowise/state.json", "task-events/applied", "sync-events/synced"]);
  git(repo, ["commit", "-m", "test: C2 with release overlay"]);
  const c2Sha = revParse(repo, "HEAD");
  assert.equal(inspectCloseoutState(closeoutOptions(fixture, repo)).action, "atomic_deliver_c2_and_release");
  assert.equal(finalizeRemoteCloseout({ repoPath: repo, prepared, c1Sha, c2Sha }).decision, "READY");
  assert.equal(inspectCloseoutState(closeoutOptions(fixture, repo)).action, "terminal_verify");
}

async function verifyAuthorizationContinuation() {
  const fixture = createFixture("jv37-authorization");
  const repo = fixture.clones.sessionA;
  const baseSha = revParse(repo, "HEAD");
  const approved = authorizationReceipt(repo, baseSha);
  const unchanged = inspectAuthorizationContinuation({ repoPath: repo, approved, current: { ...approved } });
  assert.equal(unchanged.reason, "authorization_invariants_unchanged");

  fs.writeFileSync(path.join(repo, "docs-unrelated.md"), "unrelated\n");
  git(repo, ["add", "docs-unrelated.md"]);
  git(repo, ["commit", "-m", "test: unrelated fast-forward"]);
  const safe = inspectAuthorizationContinuation({
    repoPath: repo,
    approved,
    current: { ...approved, commit_scope: ["scope.txt"] },
  });
  assert.equal(safe.reason, "safe_non_overlapping_fast_forward");
  const changedScope = inspectAuthorizationContinuation({
    repoPath: repo,
    approved,
    current: { ...approved, commit_scope: ["docs-unrelated.md"] },
  });
  assert.equal(changedScope.reason, "scope_changed");
  const changedVerifier = inspectAuthorizationContinuation({
    repoPath: repo,
    approved,
    current: { ...approved, verifiers: ["node changed-verifier.mjs"], commit_scope: ["scope.txt"] },
  });
  assert.equal(changedVerifier.reason, "verifier_changed");
  const invalidBase = inspectAuthorizationContinuation({
    repoPath: repo,
    approved: { ...approved, base_sha: "f".repeat(40) },
    current: { ...approved, commit_scope: ["scope.txt"] },
  });
  assert.equal(invalidBase.reason, "base_not_safe");

  fs.writeFileSync(path.join(repo, "scope.txt"), "committed scope change\n");
  git(repo, ["add", "scope.txt"]);
  git(repo, ["commit", "-m", "test: overlap authorized scope"]);
  const overlap = inspectAuthorizationContinuation({
    repoPath: repo,
    approved,
    current: { ...approved, commit_scope: ["scope.txt"] },
  });
  assert.equal(overlap.reason, "base_path_overlap");

  fs.writeFileSync(path.join(repo, "scope.txt"), "uncommitted scope change\n");
  const dirtyScope = inspectAuthorizationContinuation({
    repoPath: repo,
    approved,
    current: { ...approved, commit_scope: ["scope.txt"] },
  });
  assert.equal(dirtyScope.reason, "diff_changed", "copied caller fingerprints must not hide an uncommitted scope change");
}

async function verifyRemoteTerminalCloseout() {
  const fixture = createFixture("jv37-terminal");
  const repo = fixture.clones.sessionA;
  const claim = makeClaim("session-terminal", revParse(repo, "HEAD"), "claim-terminal");
  assert.equal(acquireRemoteClaim({ repoPath: repo, claim }).decision, "READY");

  fs.writeFileSync(path.join(repo, "c1.txt"), "C1\n");
  git(repo, ["add", "c1.txt"]);
  git(repo, ["commit", "-m", "test: C1"]);
  const c1Sha = revParse(repo, "HEAD");
  const delivery = recordC1Delivery({
    repoPath: repo,
    projectId: claim.project_id,
    taskId: claim.task_id,
    environmentId: "fixture-terminal",
    sessionId: "terminal-worker",
    actor: claim.actor,
    baseSha: claim.base_sha,
    commitSha: c1Sha,
    scopePaths: ["c1.txt"],
  });
  assert.equal(delivery.decision, "READY", delivery.reason);
  git(repo, ["push", "origin", "main"]);
  transitionState(repo, claim, "c1_remote_synced", { c1_sha: c1Sha, delivery_refs: [delivery.ref] });
  writeOverlay(repo, claim, "remote_synced", "todo");
  const canonical = transitionState(repo, claim, "canonical_applied");
  applyCanonicalCompletionEvent(repo, claim, canonical);
  resolveFixtureSyncEvents(repo, "fresh-session-terminal");
  transitionState(repo, claim, "closeout_synced");
  transitionState(repo, claim, "residual_zero", { scope_paths: ["c1.txt", "c2.txt"] });

  const prepared = prepareRemoteRelease({ repoPath: repo, projectId: claim.project_id, taskId: claim.task_id, claim, performedBySessionId: "fresh-session-terminal" });
  assert.equal(prepared.decision, "READY");
  assert.equal(inspectC2CloseoutTree({ repoPath: repo, prepared, c1Sha, c2Sha: revParse(repo, "HEAD") }).reason, "c2_release_event_missing");
  applyPreparedReleaseEvent(repo, claim, prepared);
  fs.writeFileSync(path.join(repo, "c2.txt"), "C2\n");
  git(repo, ["add", "c2.txt", "milestones/morrowise/state.json", "task-events/applied", "sync-events/synced"]);
  git(repo, ["commit", "-m", "test: C2"]);
  const c2Sha = revParse(repo, "HEAD");
  assert.equal(finalizeRemoteCloseout({ repoPath: repo, prepared: { ...prepared, sha: c1Sha }, c1Sha, c2Sha }).reason, "release_proof_invalid");
  assert.equal(finalizeRemoteCloseout({ repoPath: repo, prepared, c1Sha, c2Sha }).decision, "READY");

  const terminalOptions = {
    repoPath: repo,
    root: repo,
    projectId: "morrowise",
    taskId: "jv37",
    c1Sha,
    c2Sha,
    scopePaths: ["c1.txt", "c2.txt"],
  };
  assert.equal(inspectTerminalCloseout(terminalOptions).decision, "READY");
  const realSessionOptions = {
    repoPath: repo,
    pilotId: "runtime-real-session-path",
    sessionId: "terminal-session",
    environmentId: "portable-fixture",
    observedAt: "2026-08-12T01:12:00Z",
    exclusions: ["task-events/latest-report.json"],
    commitScope: ["c1.txt", "c2.txt"],
  };
  const preparedSessionObservation = preparePilotObservation(realSessionOptions);
  assert.equal(preparedSessionObservation.decision, "READY", preparedSessionObservation.reason);
  const realSessionObservation = recordPilotObservation(realSessionOptions);
  assert.equal(realSessionObservation.decision, "READY", `${realSessionObservation.reason}: ${realSessionObservation.details || ""}`);
  assert.equal(realSessionObservation.record.attestation_kind, "github_remote_actor");
  assert.equal(realSessionObservation.record.environment_id, "portable-fixture");
  assert.equal(inspectTerminalCloseout({ ...terminalOptions, scopePaths: [] }).reason, "scope_proof_missing");
  assert.equal(inspectTerminalCloseout({ ...terminalOptions, scopePaths: ["c1.txt"] }).reason, "scope_proof_mismatch");
  assert.equal(inspectTerminalCloseout({ ...terminalOptions, c2Sha: "e".repeat(40) }).reason, "remote_missing_c2");

  writeJson(path.join(repo, "task-events", "pending", "pending.json"), { project: "morrowise", task_id: "jv37" });
  assert.equal(inspectTerminalCloseout(terminalOptions).decision, "READY", "terminal truth must come from the pushed C2 tree, not an uncommitted local pending file");
  fs.unlinkSync(path.join(repo, "task-events", "pending", "pending.json"));
  fs.writeFileSync(path.join(repo, "c2.txt"), "residual\n");
  assert.equal(inspectTerminalCloseout(terminalOptions).reason, "scope_residual_nonzero");
}

async function verifyMultiCloneNegativeFixtures() {
  const fixture = createFixture("jv37-multi-clone", { generatedFixture: true });
  const { sessionA, sessionB, sessionC } = fixture.clones;

  fs.writeFileSync(path.join(sessionA, "worker-a.txt"), "A\n");
  git(sessionA, ["add", "worker-a.txt"]);
  git(sessionA, ["commit", "-m", "test: worker A delivery"]);
  const workerASha = revParse(sessionA, "HEAD");
  assert.notEqual(gitStatus(sessionB, ["cat-file", "-e", `${workerASha}^{commit}`]), 0, "unpushed commit must be invisible");
  git(sessionA, ["push", "origin", "main"]);
  const behind = inspectRepo(sessionB);
  assert.equal(behind.reason, "ff_only_required");
  assert.equal(repoReady(sessionB, { autoFf: true }).decision, "READY");
  assert.equal(revParse(sessionB, "HEAD"), workerASha);

  assert.equal(repoReady(sessionC, { autoFf: true }).decision, "READY");
  fs.writeFileSync(path.join(sessionB, "local-ahead.txt"), "ahead\n");
  git(sessionB, ["add", "local-ahead.txt"]);
  git(sessionB, ["commit", "-m", "test: local ahead"]);
  assert.equal(inspectRepo(sessionB).reason, "needs_push");
  fs.writeFileSync(path.join(sessionC, "remote-race.txt"), "remote\n");
  git(sessionC, ["add", "remote-race.txt"]);
  git(sessionC, ["commit", "-m", "test: remote race"]);
  git(sessionC, ["push", "origin", "main"]);
  assert.equal(inspectRepo(sessionB).reason, "needs_reconcile");

  const detached = cloneFresh(fixture, "detached");
  git(detached, ["switch", "--detach"]);
  assert.equal(inspectRepo(detached).reason, "detached_blocked");
  const noUpstream = path.join(fixture.tmp, "no-upstream");
  git(fixture.tmp, ["init", "-b", "main", noUpstream]);
  assert.equal(inspectRepo(noUpstream, { fetch: false }).reason, "no_upstream");
  const feature = cloneFresh(fixture, "feature");
  git(feature, ["switch", "-c", "fixture-feature"]);
  git(feature, ["branch", "--set-upstream-to=origin/main"]);
  assert.equal(inspectRepo(feature).reason, "non_main_branch");

  const dirty = cloneFresh(fixture, "dirty");
  fs.writeFileSync(path.join(dirty, "manual.txt"), "manual\n");
  assert.equal(inspectRepo(dirty).reason, "dirty_blocked");
  assert.equal(inspectRepo(dirty, { exclusions: ["manual.txt"], commitScope: ["scope.txt"] }).reason, "unrelated_dirty_excluded");

  const scopeOwned = cloneFresh(fixture, "scope-owned");
  fs.mkdirSync(path.join(scopeOwned, "legal"), { recursive: true });
  fs.writeFileSync(path.join(scopeOwned, "legal", "privacy.txt"), "policy\n");
  assert.equal(
    inspectRepo(scopeOwned, { commitScope: ["legal/privacy.txt"] }).reason,
    "scope_owned_dirty",
    "an exact scope must allow its own nested untracked file",
  );

  const unicodeScopeOwned = cloneFresh(fixture, "scope-owned-unicode");
  const unicodeScopePath = "docs/acceptance/RRO-10_正式落地版未達Prototype預期成果_歸因報告.md";
  fs.mkdirSync(path.dirname(path.join(unicodeScopeOwned, unicodeScopePath)), { recursive: true });
  fs.writeFileSync(path.join(unicodeScopeOwned, unicodeScopePath), "歸因報告\n");
  git(unicodeScopeOwned, ["config", "core.quotePath", "true"]);
  assert.equal(
    inspectRepo(unicodeScopeOwned, { commitScope: [unicodeScopePath] }).reason,
    "scope_owned_dirty",
    "an exact scope must match an untracked Unicode path even when Git quotes non-ASCII bytes",
  );

  const scopeWithExclusion = cloneFresh(fixture, "scope-with-exclusion");
  fs.writeFileSync(path.join(scopeWithExclusion, "scope.txt"), "owned\n");
  fs.writeFileSync(path.join(scopeWithExclusion, "other-session.txt"), "preserve\n");
  assert.equal(
    inspectRepo(scopeWithExclusion, {
      commitScope: ["scope.txt"],
      exclusions: ["other-session.txt"],
    }).reason,
    "scope_owned_dirty_with_exclusions",
    "an exact scope may coexist with a proven unrelated exclusion",
  );

  const staged = cloneFresh(fixture, "staged-dirty");
  fs.writeFileSync(path.join(staged, "staged.txt"), "staged\n");
  git(staged, ["add", "staged.txt"]);
  const stagedResult = inspectRepo(staged);
  assert.equal(stagedResult.reason, "dirty_blocked");
  assert.equal(stagedResult.snapshot.staged_count, 1);
  const behindDirty = cloneFresh(fixture, "behind-dirty");
  fs.writeFileSync(path.join(behindDirty, "manual.txt"), "manual\n");
  const pusher = cloneFresh(fixture, "behind-pusher");
  fs.writeFileSync(path.join(pusher, "new-remote.txt"), "new\n");
  git(pusher, ["add", "new-remote.txt"]);
  git(pusher, ["commit", "-m", "test: advance remote"]);
  git(pusher, ["push", "origin", "main"]);
  assert.equal(inspectRepo(behindDirty, { exclusions: ["manual.txt"], commitScope: ["scope.txt"] }).reason, "dirty_blocked");

  const renamed = cloneFresh(fixture, "renamed");
  git(renamed, ["mv", "old.txt", "scope.txt"]);
  assert.equal(inspectRepo(renamed, { exclusions: ["old.txt"], commitScope: ["scope.txt"] }).reason, "dirty_blocked");

  const generated = cloneFresh(fixture, "generated");
  fs.writeFileSync(path.join(generated, "public", "data", "generated.txt"), "generated-v2\n");
  const generatedReady = inspectRepo(generated);
  assert.equal(generatedReady.reason, "generated_dirty_warning");
  fs.writeFileSync(path.join(generated, "manual-too.txt"), "manual\n");
  assert.equal(inspectRepo(generated).reason, "dirty_blocked");

  const managed = cloneFresh(fixture, "managed-block");
  fs.writeFileSync(path.join(managed, "ARCHITECTURE.md"), managedArchitecture("generated-new\n"));
  const managedReady = inspectRepo(managed);
  assert.equal(managedReady.reason, "generated_dirty_warning");
  const mixedManaged = cloneFresh(fixture, "managed-block-mixed");
  fs.writeFileSync(path.join(mixedManaged, "ARCHITECTURE.md"), `manual changed\n${managedArchitecture("generated-new\n").split("\n").slice(1).join("\n")}`);
  const mixedManagedResult = inspectRepo(mixedManaged);
  assert.equal(mixedManagedResult.reason, "dirty_blocked");
  assert.equal(mixedManagedResult.snapshot.dirty_kind, "mixed");

  const worktreeRepo = cloneFresh(fixture, "worktree-owner");
  const linked = path.join(fixture.tmp, "linked-same-main");
  git(worktreeRepo, ["worktree", "add", "--force", linked, "main"]);
  assert.equal(inspectRepo(worktreeRepo).reason, "worktree_conflict");

  const authBlocked = cloneFresh(fixture, "auth-blocked");
  git(authBlocked, ["remote", "set-url", "origin", path.join(fixture.tmp, "missing.git")]);
  assert.equal(inspectRepo(authBlocked).reason, "auth_blocked");

  const coordinationFixture = createFixture("jv37-e2e05-coordination");
  const coordinationRepo = coordinationFixture.clones.sessionA;
  const firstClaim = makeClaim("e2e05-owner", revParse(coordinationRepo, "HEAD"), "e2e05-claim-a");
  const secondClaim = makeClaim("e2e05-contender", firstClaim.base_sha, "e2e05-claim-b");
  const claimed = acquireRemoteClaim({ repoPath: coordinationRepo, claim: firstClaim });
  assert.equal(claimed.decision, "READY");
  assert.equal(acquireRemoteClaim({ repoPath: coordinationFixture.clones.sessionB, claim: secondClaim }).reason, "claim_conflict");
  assert.equal(inspectCloseoutState(closeoutOptions(coordinationFixture, coordinationRepo)).action, "apply_claim_event", "missing event must be detected from durable claim state");
  assert.equal(authorizeCanonicalApply({ ...firstClaim, owner_role: "worker", state: "c1_remote_synced" }).reason, "wrong_integrator");
  const applyLock = path.join(coordinationRepo, "task-events", ".jv37-apply.lock");
  fs.mkdirSync(applyLock, { recursive: true });
  assert.throws(() => applyTaskEvents({ root: coordinationRepo, runGenerateData: false }), /task_event_apply_locked/);
  fs.rmdirSync(applyLock);
  assert.equal(inspectCloseoutState({ repoPath: authBlocked, root: authBlocked, projectId: "morrowise", taskId: "jv37" }).reason, "auth_blocked");

  const race = createFixture("jv37-push-race");
  for (const [name, repo] of [["one", race.clones.sessionA], ["two", race.clones.sessionB]]) {
    fs.writeFileSync(path.join(repo, `${name}.txt`), `${name}\n`);
    git(repo, ["add", `${name}.txt`]);
    git(repo, ["commit", "-m", `test: push ${name}`]);
  }
  const pushes = await Promise.all([
    runAsync("git", ["push", "origin", "main"], { cwd: race.clones.sessionA }),
    runAsync("git", ["push", "origin", "main"], { cwd: race.clones.sessionB }),
  ]);
  assert.deepEqual(pushes.map((item) => item.status).sort(), [0, 1]);

  const ownerFixture = createFixture("jv37-owner-single-writer");
  const ownerRepo = ownerFixture.clones.sessionA;
  fs.writeFileSync(path.join(ownerRepo, "owner.txt"), "owner main\n");
  git(ownerRepo, ["add", "owner.txt"]);
  git(ownerRepo, ["commit", "-m", "test: owner single-writer main"]);
  const ownerSha = revParse(ownerRepo, "HEAD");
  git(ownerRepo, ["push", "origin", "main"]);
  assert.equal(revParse(ownerRepo, "origin/main"), ownerSha);
  assert.equal(inspectRepo(ownerRepo).reason, "READY");

  const source = fs.readFileSync(new URL("./lib/repo-coordination-runtime.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /git\s+(?:reset|rebase|stash)|force-with-lease|--force/);
  assert.equal(classifyRepoSnapshot({ fetch_ok: true, branch_head: "main", upstream: "origin/main", ahead: 0, behind: 0, dirty_kind: "generated_only", generated_proof_valid: false }).reason, "dirty_blocked");
}

async function verifyRuntimeCli() {
  const fixture = createFixture("jv37-runtime-cli");
  const repo = fixture.clones.sessionA;
  const runtimePath = fileURLToPath(new URL("./repo-coordination-runtime.mjs", import.meta.url));
  const claim = makeClaim("runtime-cli", revParse(repo, "HEAD"), "claim-cli");
  const claimPath = writeJson(path.join(fixture.tmp, "claim.json"), claim);
  const acquired = spawnSync(process.execPath, [runtimePath, "remote-claim", "--repo", repo, "--input", claimPath], { encoding: "utf8" });
  assert.equal(acquired.status, 0, acquired.stderr || acquired.stdout);
  const proof = JSON.parse(acquired.stdout);
  const eventPath = writeJson(path.join(fixture.tmp, "claim-event.json"), coordinationEvent("task.claimed", claim, proof, { commit: null }));
  const event = spawnSync(process.execPath, [runtimePath, "event", "--root", repo, "--input", eventPath], { cwd: fixture.tmp, encoding: "utf8" });
  assert.equal(event.status, 0, event.stderr || event.stdout);
  const written = JSON.parse(event.stdout);
  assert.match(written.event.event_id, /^task\.claimed-/);
  const harnessPending = path.join(repo, "task-events", "pending");
  assert.equal(fs.existsSync(path.join(fixture.tmp, "task-events")), false, "default event root must not follow cwd");
  const eventFile = fs.readdirSync(harnessPending).find((file) => file.includes("claim-cli") && file.endsWith(".json"));
  assert.ok(eventFile, "event must land in harness-mc pending by default");

  const next = spawnSync(process.execPath, [runtimePath, "next", "--repo", repo, "--root", repo, "--project", "morrowise", "--task", "jv37"], { encoding: "utf8" });
  assert.equal(next.status, 0, next.stderr || next.stdout);
  assert.equal(JSON.parse(next.stdout).action, "apply_claim_event");
  assert.deepEqual(applyTaskEvents({ root: repo, runGenerateData: false }).applied.map((item) => item.type), ["task.claimed"]);

  fs.writeFileSync(path.join(repo, "c1-cli.txt"), "C1\n");
  git(repo, ["add", "c1-cli.txt"]);
  git(repo, ["commit", "-m", "test: CLI C1"]);
  const c1Sha = revParse(repo, "HEAD");
  const delivery = recordC1Delivery({
    repoPath: repo,
    projectId: claim.project_id,
    taskId: claim.task_id,
    environmentId: "fixture-cli",
    sessionId: "runtime-cli-worker",
    actor: claim.actor,
    baseSha: claim.base_sha,
    commitSha: c1Sha,
    scopePaths: ["c1-cli.txt"],
  });
  assert.equal(delivery.decision, "READY", delivery.reason);
  git(repo, ["push", "origin", "main"]);
  let canonical;
  for (const nextState of ["c1_remote_synced", "canonical_applied", "closeout_synced", "residual_zero"]) {
    const transitioned = transitionRemoteClaim({
      repoPath: repo,
      projectId: claim.project_id,
      taskId: claim.task_id,
      claim,
      nextState,
      performedBySessionId: nextState === "c1_remote_synced" ? claim.session_id : "runtime-cli-fresh",
      evidence: nextState === "c1_remote_synced"
        ? { c1_sha: c1Sha, delivery_refs: [delivery.ref] }
        : nextState === "canonical_applied" ? {
          ...authorizationEvidence(repo, claim, authorizationReceipt(repo, c1Sha)),
        } : nextState === "residual_zero" ? { scope_paths: ["c1-cli.txt", "c2-cli.txt"] } : {},
    });
    assert.equal(transitioned.decision, "READY", transitioned.reason);
    if (nextState === "canonical_applied") {
      canonical = transitioned;
      applyCanonicalCompletionEvent(repo, claim, canonical);
      resolveFixtureSyncEvents(repo, "runtime-cli-fresh");
    }
  }
  const prepare = spawnSync(process.execPath, [runtimePath, "prepare-release", "--repo", repo, "--input", claimPath, "--session", "runtime-cli-fresh"], { encoding: "utf8" });
  assert.equal(prepare.status, 0, prepare.stderr || prepare.stdout);
  const preparedPath = writeJson(path.join(fixture.tmp, "prepared.json"), JSON.parse(prepare.stdout));
  applyPreparedReleaseEvent(repo, claim, JSON.parse(prepare.stdout));
  fs.writeFileSync(path.join(repo, "c2-cli.txt"), "C2\n");
  git(repo, ["add", "c2-cli.txt", "milestones/morrowise/state.json", "task-events/applied", "sync-events/synced"]);
  git(repo, ["commit", "-m", "test: CLI C2"]);
  const c2Sha = revParse(repo, "HEAD");
  const finalize = spawnSync(process.execPath, [runtimePath, "finalize-closeout", "--repo", repo, "--input", preparedPath, "--c1", c1Sha, "--c2", c2Sha], { encoding: "utf8" });
  assert.equal(finalize.status, 0, finalize.stderr || finalize.stdout);
  assert.equal(JSON.parse(finalize.stdout).reason, "c2_and_release_remote_atomic");
}

async function verifyRealMultiSessionPilot(options) {
  if (!options.receiptPath || !options.repoPath) {
    throw new Error("BLOCKED real_pilot_receipt_missing: pass --receipt <source-bound JSON> --repo <live-clone>");
  }
  const receipt = JSON.parse(fs.readFileSync(path.resolve(options.receiptPath), "utf8"));
  const tasksPath = path.resolve("milestones/morrowise/tasks.json");
  const { validatePilotReceipt } = await import("./lib/repo-coordination-runtime.mjs");
  const canonicalRoot = path.resolve(".");
  const result = validatePilotReceipt(receipt, {
    repoPath: options.repoPath,
    tasksPath,
    root: canonicalRoot,
    expectedRemoteUrlHash: remoteIdentityHash(canonicalRoot),
  });
  assert.equal(result.decision, "READY", `${result.reason}: ${result.details || ""}`);
}

function createFixture(prefix, options = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  const remote = path.join(tmp, "remote.git");
  git(tmp, ["init", "--bare", remote]);
  const seed = path.join(tmp, "seed");
  git(tmp, ["init", "-b", "main", seed]);
  configure(seed);
  const trust = createFixtureTrust();
  fs.mkdirSync(path.join(seed, "milestones", "morrowise"), { recursive: true });
  fs.mkdirSync(path.join(seed, "system-workflow", "registries"), { recursive: true });
  writeJson(path.join(seed, "milestones", "morrowise", "tasks.json"), {
    tasks: [{ id: "jv37", title: "Repo coordination fixture", status: "todo", repo_coordination_required: true, acceptance_matrix: [] }],
  });
  writeJson(path.join(seed, "system-workflow", "registries", "jv37-authorization-approvers.json"), trust.registry);
  fs.writeFileSync(path.join(seed, "README.md"), "seed\n");
  fs.writeFileSync(path.join(seed, "old.txt"), "rename-source\n");
  if (options.generatedFixture) addGeneratedFixture(seed);
  git(seed, ["add", "."]);
  git(seed, ["commit", "-m", "fixture: seed"]);
  git(seed, ["remote", "add", "origin", remote]);
  git(seed, ["push", "-u", "origin", "main"]);
  git(tmp, ["--git-dir", remote, "symbolic-ref", "HEAD", "refs/heads/main"]);
  const clones = {};
  for (const name of ["sessionA", "sessionB", "sessionC"]) {
    clones[name] = path.join(tmp, name);
    git(tmp, ["clone", remote, clones[name]]);
    configure(clones[name]);
    fixtureTrustByRepo.set(clones[name], trust);
  }
  return { tmp, remote, seed, clones, trust };
}

function addGeneratedFixture(seed) {
  const source = "source-v1\n";
  const output = "generated-v2\n";
  fs.mkdirSync(path.join(seed, "public", "data"), { recursive: true });
  fs.mkdirSync(path.join(seed, ".morrowise"), { recursive: true });
  fs.writeFileSync(path.join(seed, "source.txt"), source);
  fs.writeFileSync(path.join(seed, "public", "data", "generated.txt"), "generated-v1\n");
  fs.writeFileSync(path.join(seed, "ARCHITECTURE.md"), managedArchitecture("generated-old\n"));
  const expectedArchitecture = managedArchitecture("generated-new\n");
  const start = "<!-- BEGIN JV37 GENERATED -->";
  const end = "<!-- END JV37 GENERATED -->";
  const startIndex = expectedArchitecture.indexOf(start);
  const endIndex = expectedArchitecture.indexOf(end);
  const generatedContent = expectedArchitecture.slice(startIndex + start.length, endIndex);
  const outsideContent = `${expectedArchitecture.slice(0, startIndex + start.length)}<JV37_MANAGED_BLOCK>${expectedArchitecture.slice(endIndex)}`;
  writeJson(path.join(seed, ".morrowise", "repo-coordination-generated.json"), {
    version: 1,
    generated_paths: [
      {
        path: "public/data/generated.txt",
        mode: "generated_only",
        output_sha256: sha256(output),
        sources: [{ path: "source.txt", sha256: sha256(source) }],
      },
      {
        path: "ARCHITECTURE.md",
        mode: "managed_block",
        start_marker: start,
        end_marker: end,
        generated_sha256: sha256(generatedContent),
        outside_sha256: sha256(outsideContent),
        sources: [{ path: "source.txt", sha256: sha256(source) }],
      },
    ],
  });
}

function managedArchitecture(generatedContent) {
  return `manual intro\n<!-- BEGIN JV37 GENERATED -->${generatedContent}<!-- END JV37 GENERATED -->\nmanual footer\n`;
}

function cloneFresh(fixture, name) {
  const target = path.join(fixture.tmp, name);
  git(fixture.tmp, ["clone", fixture.remote, target]);
  configure(target);
  return target;
}

function makeClaim(sessionId, baseSha, claimId) {
  return {
    claim_id: claimId,
    task_id: "jv37",
    project_id: "morrowise",
    repo_class: "shared_core_multi_writer",
    branch: "main",
    base_sha: baseSha,
    claimed_at: "2026-08-12T01:00:00Z",
    owner_role: "integrator",
    actor: "codex",
    session_id: sessionId,
  };
}

function coordinationEvent(type, claim, remoteResult, options = {}) {
  const state = remoteResult.record?.state || (type === "task.claimed" ? "claimed" : null);
  return {
    type,
    repo: "harness-mc",
    ...(options.commit ? { commit: options.commit } : {}),
    project: claim.project_id,
    task_id: claim.task_id,
    summary: `${type} fixture`,
    actor: claim.actor,
    session_id: claim.session_id,
    created_at: "2026-08-12T01:00:00Z",
    coordination: {
      ...claim,
      remote_claim_ref: remoteResult.ref,
      remote_claim_sha: remoteResult.sha,
      remote_state: state,
    },
  };
}

function transitionState(repo, claim, nextState, evidence = {}) {
  const authorizationSnapshot = authorizationReceipt(repo, revParse(repo, "HEAD"));
  const result = transitionRemoteClaim({
    repoPath: repo,
    projectId: claim.project_id,
    taskId: claim.task_id,
    claim,
    nextState,
    performedBySessionId: "fresh-session-recovery",
    evidence: {
      ...evidence,
      ...(nextState === "canonical_applied" ? authorizationEvidence(repo, claim, authorizationSnapshot) : {}),
    },
  });
  assert.equal(result.decision, "READY", `${result.reason}: ${result.details || ""}`);
  return result;
}

function writeOverlay(repo, claim, claimState, status) {
  const task = { status };
  if (claim) task.coordination = { active_claim: { ...claim, state: claimState } };
  else task.coordination = { active_claim: null };
  writeJson(path.join(repo, "milestones", "morrowise", "state.json"), { tasks: { jv37: task } });
}

function applyPreparedReleaseEvent(repo, claim, prepared) {
  const event = coordinationEvent("task.released", claim, prepared, { commit: null });
  event.session_id = prepared.record.transition_history.at(-1).performed_by_session_id;
  event.coordination.remote_release_prepared = true;
  writeTaskEvent({ root: repo, ...event });
  const report = applyTaskEvents({ root: repo, runGenerateData: false });
  assert.deepEqual(report.applied.map((item) => item.type), ["task.released"]);
}

function applyCanonicalCompletionEvent(repo, claim, canonical) {
  writeOverlay(repo, claim, "remote_synced", "todo");
  const event = coordinationEvent("task.completed", claim, canonical, { commit: claim.base_sha });
  event.session_id = canonical.record.transition_history.at(-1).performed_by_session_id;
  writeTaskEvent({ root: repo, ...event });
  const report = applyTaskEvents({ root: repo, runGenerateData: false });
  assert.deepEqual(report.applied.map((item) => item.type), ["task.completed"]);
}

function resolveFixtureSyncEvents(repo, sessionId) {
  const pendingDir = path.join(repo, "sync-events", "pending");
  if (!fs.existsSync(pendingDir)) return;
  for (const fileName of fs.readdirSync(pendingDir).filter((name) => name.endsWith(".json"))) {
    const event = JSON.parse(fs.readFileSync(path.join(pendingDir, fileName), "utf8"));
    skipSyncRequest({
      root: repo,
      sync_event_id: event.sync_event_id,
      exemption_reason: "JV-37 isolated verifier has no external sync target",
      verifier: "verify-multi-machine-repo-coordination-gate",
      actor: "jv37-fixture",
      session_id: sessionId,
      resolved_at: "2026-08-12T01:11:00Z",
    });
  }
}

function completeConcurrentDeliveryCloseout({ repo, claim, deliveries }) {
  git(repo, ["push", "origin", "main"]);
  const c1Sha = revParse(repo, "HEAD");
  const remoteSynced = transitionRemoteClaim({
    repoPath: repo,
    projectId: claim.project_id,
    taskId: claim.task_id,
    claim,
    nextState: "c1_remote_synced",
    performedBySessionId: claim.session_id,
    evidence: {
      c1_sha: c1Sha,
      delivery_refs: deliveries.map((item) => item.ref),
    },
  });
  assert.equal(remoteSynced.decision, "READY", remoteSynced.reason);
  writeTaskEvent({ root: repo, ...coordinationEvent("task.remote_synced", claim, remoteSynced, { commit: c1Sha }) });
  assert.deepEqual(applyTaskEvents({ root: repo, runGenerateData: false }).applied.map((item) => item.type), ["task.remote_synced"]);

  const approved = authorizationReceipt(repo, c1Sha);
  const continuation = inspectAuthorizationContinuation({ repoPath: repo, approved, current: { ...approved } });
  assert.equal(continuation.decision, "READY", continuation.reason);
  const canonical = transitionRemoteClaim({
    repoPath: repo,
    projectId: claim.project_id,
    taskId: claim.task_id,
    claim,
    nextState: "canonical_applied",
    performedBySessionId: "fresh-integrator-session",
    evidence: {
      ...authorizationEvidence(repo, claim, approved),
    },
  });
  assert.equal(canonical.decision, "READY", canonical.reason);
  applyCanonicalCompletionEvent(repo, claim, canonical);
  resolveFixtureSyncEvents(repo, "fresh-integrator-session");
  transitionState(repo, claim, "closeout_synced");
  transitionState(repo, claim, "residual_zero", { scope_paths: ["worker-a.txt", "worker-b.txt", "c2-delivery.txt"] });
  const prepared = prepareRemoteRelease({
    repoPath: repo,
    projectId: claim.project_id,
    taskId: claim.task_id,
    claim,
    performedBySessionId: "fresh-integrator-session",
  });
  assert.equal(prepared.decision, "READY", prepared.reason);
  applyPreparedReleaseEvent(repo, claim, prepared);
  fs.writeFileSync(path.join(repo, "c2-delivery.txt"), "C2\n");
  git(repo, ["add", "c2-delivery.txt", "milestones/morrowise/state.json", "task-events/applied", "sync-events/synced"]);
  git(repo, ["commit", "-m", "test: single-integrator C2"]);
  const c2Sha = revParse(repo, "HEAD");
  const finalized = finalizeRemoteCloseout({ repoPath: repo, prepared, c1Sha, c2Sha });
  assert.equal(finalized.decision, "READY", finalized.reason);
  const terminal = inspectTerminalCloseout({
    repoPath: repo,
    root: repo,
    projectId: claim.project_id,
    taskId: claim.task_id,
    c1Sha,
    c2Sha,
    scopePaths: ["worker-a.txt", "worker-b.txt", "c2-delivery.txt"],
  });
  assert.equal(terminal.decision, "READY", terminal.reason);
}

function closeoutOptions(fixture, repo) {
  return { repoPath: repo, root: repo, projectId: "morrowise", taskId: "jv37" };
}

function authorizationReceipt(repo, baseSha) {
  return deriveAuthorizationSnapshot({
    repoPath: repo,
    input: {
    grouping: ["scope.txt"],
    message: "test: authorized delivery",
    verifiers: [{ id: "jv37-authorization-invariants" }],
    owner: "integrator-1",
    human_decision: "approved",
    base_sha: baseSha,
    commit_scope: ["scope.txt"],
    },
  });
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

function authorizationEvidence(repo, claim, snapshot) {
  const trust = fixtureTrustByRepo.get(repo);
  assert.ok(trust, `fixture trust missing for ${repo}`);
  fixtureApprovalSequence += 1;
  const approvalId = `fixture-approval-${fixtureApprovalSequence}`;
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
  const record = signFixtureRecord(unsigned, trust.approver.privateKey);
  const ref = `refs/jv37/approvals/${claim.project_id}/${claim.task_id}/${approvalId}`;
  const sha = publishFixtureRecord(repo, ref, "approval.json", record);
  return {
    authorization_approval_ref: ref,
    authorization_approval_sha: sha,
    authorization_current: { ...snapshot },
  };
}

function signFixtureRecord(unsigned, privateKey) {
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

function configure(repo) {
  git(repo, ["config", "user.email", "fixture@example.invalid"]);
  git(repo, ["config", "user.name", "JV37 Fixture"]);
}

function parseArgs(argv) {
  const options = { caseName: null, receiptPath: null, repoPath: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--case") options.caseName = argv[++index] || null;
    else if (arg === "--receipt") options.receiptPath = argv[++index] || null;
    else if (arg === "--repo") options.repoPath = path.resolve(argv[++index] || ".");
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function git(cwd, args, options = {}) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", input: options.input });
  assert.equal(result.status, 0, `git ${args.join(" ")}\n${result.stderr || result.stdout}`);
  return result;
}

function gitStatus(cwd, args) {
  return spawnSync("git", args, { cwd, encoding: "utf8" }).status;
}

function revParse(cwd, ref) {
  return git(cwd, ["rev-parse", ref]).stdout.trim();
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  return filePath;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function runAsync(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: options.cwd, encoding: "utf8" });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}
