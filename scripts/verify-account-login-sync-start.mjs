import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import {
  evaluateAccountLoginSyncStart,
  probeAccountLoginSyncStart,
} from "./account-login-sync-start.mjs";

const OBSERVED_AT = "2026-08-06T11:55:00.000Z";
const EVALUATED_AT = "2026-08-06T12:00:00.000Z";

function git(root, args, { quiet = true } = {}) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf-8",
    stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit",
  }).trim();
}

function configureIdentity(root) {
  git(root, ["config", "user.email", "verify@example.test"]);
  git(root, ["config", "user.name", "JV-45 Verify"]);
}

function evaluate(input, evaluatedAt = EVALUATED_AT) {
  return evaluateAccountLoginSyncStart(input, { evaluatedAt });
}

function probe(root, observedAt = OBSERVED_AT, probeRemote = true) {
  return probeAccountLoginSyncStart({ root, observedAt, probeRemote });
}

function createRemoteAndSessions() {
  const remoteParent = fs.mkdtempSync(path.join(os.tmpdir(), "jv45-remote-"));
  const remoteRoot = path.join(remoteParent, "canonical.git");
  fs.mkdirSync(remoteRoot);
  git(remoteRoot, ["init", "--bare"]);

  const seedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "jv45-seed-"));
  git(seedRoot, ["init"]);
  configureIdentity(seedRoot);
  fs.writeFileSync(path.join(seedRoot, "README.md"), "canonical\n");
  git(seedRoot, ["add", "README.md"]);
  git(seedRoot, ["commit", "-m", "seed"]);
  git(seedRoot, ["remote", "add", "origin", remoteRoot]);
  git(seedRoot, ["push", "-u", "origin", "HEAD"]);

  const branch = git(seedRoot, ["branch", "--show-current"]);
  git(remoteRoot, ["symbolic-ref", "HEAD", `refs/heads/${branch}`]);
  const sessionA = fs.mkdtempSync(path.join(os.tmpdir(), "jv45-session-a-"));
  const sessionB = fs.mkdtempSync(path.join(os.tmpdir(), "jv45-session-b-"));
  git(sessionA, ["clone", remoteRoot, "."]);
  git(sessionB, ["clone", remoteRoot, "."]);
  configureIdentity(sessionA);
  configureIdentity(sessionB);
  return { remoteRoot, sessionA, sessionB, branch };
}

const { remoteRoot, sessionA, sessionB } = createRemoteAndSessions();

assert.throws(
  () => evaluateAccountLoginSyncStart({
    account_metadata: {
      schema_version: "account-login-sync-start.v1",
      required_capabilities: [{ id: "git-remote-access", status: "available" }],
    },
    repositories: [],
  }, { evaluatedAt: EVALUATED_AT }),
  /account metadata is out of scope; Vincent manages login/,
);

assert.throws(
  () => evaluateAccountLoginSyncStart({
    repositories: [{ id: "canonical", token: "must-not-be-read" }],
    runtime_evidence: {},
  }, { evaluatedAt: EVALUATED_AT }),
  /forbidden input field: token/,
);

const readyProbeA = probe(sessionA);
const readyA = evaluate(readyProbeA);
assert.equal(readyA.decision, "ready");
assert.deepEqual(readyA.blocked_reasons, []);
assert.equal(readyA.next_action.kind, "begin_work_from_canonical_sources");
assert.equal(readyA.freshness.state, "fresh");
assert.equal(readyA.freshness.observed_at, OBSERVED_AT);
assert.equal(readyA.freshness.evaluated_at, EVALUATED_AT);
assert.equal(readyA.freshness.max_age_seconds, 900);
assert.match(readyA.evidence.reference, /^safe-probe:sha256:/);
assert.match(readyA.evidence.digest, /^sha256:[a-f0-9]{64}$/);
assert.equal(readyA.evidence.verifier_result, "safe_probe_verified");
assert.match(readyA.evidence.repositories[0].local_head, /^[a-f0-9]{40}$/);
assert.equal(readyA.evidence.repositories[0].remote_head, readyA.evidence.repositories[0].local_head);
assert.equal(JSON.stringify(readyA).includes(remoteRoot), false, "remote path must not be emitted");
assert.equal(readyA.write_boundary.read_only, true);

const readyProbeB = probe(sessionB);
const readyB = evaluate(readyProbeB);
assert.deepEqual(
  {
    decision: readyA.decision,
    remote_head: readyA.evidence.repositories[0].remote_head,
    freshness: readyA.freshness.state,
    blocked_reasons: readyA.blocked_reasons,
    next_action: readyA.next_action,
  },
  {
    decision: readyB.decision,
    remote_head: readyB.evidence.repositories[0].remote_head,
    freshness: readyB.freshness.state,
    blocked_reasons: readyB.blocked_reasons,
    next_action: readyB.next_action,
  },
  "independent fresh sessions must agree on the same remote truth",
);

const freshProcessA = spawnSync(process.execPath, [
  path.resolve("scripts", "account-login-sync-start.mjs"),
  "--probe",
  "--remote",
  "--root",
  sessionA,
], { encoding: "utf-8" });
const freshProcessB = spawnSync(process.execPath, [
  path.resolve("scripts", "account-login-sync-start.mjs"),
  "--probe",
  "--remote",
  "--root",
  sessionB,
], { encoding: "utf-8" });
assert.equal(freshProcessA.status, 0, freshProcessA.stderr);
assert.equal(freshProcessB.status, 0, freshProcessB.stderr);
const freshProcessResultA = JSON.parse(freshProcessA.stdout);
const freshProcessResultB = JSON.parse(freshProcessB.stdout);
assert.deepEqual(
  {
    decision: freshProcessResultA.decision,
    remote_head: freshProcessResultA.evidence.repositories[0].remote_head,
    freshness: freshProcessResultA.freshness.state,
    blocked_reasons: freshProcessResultA.blocked_reasons,
    next_action: freshProcessResultA.next_action,
  },
  {
    decision: freshProcessResultB.decision,
    remote_head: freshProcessResultB.evidence.repositories[0].remote_head,
    freshness: freshProcessResultB.freshness.state,
    blocked_reasons: freshProcessResultB.blocked_reasons,
    next_action: freshProcessResultB.next_action,
  },
  "independent Node processes must agree on the same remote truth",
);

const forgedEvidence = evaluate({
  repositories: readyProbeA.repositories,
  runtime_evidence: {
    ...readyProbeA.runtime_evidence,
    kind: "safe_probe",
  },
});
assert.equal(forgedEvidence.decision, "degraded");
assert.deepEqual(forgedEvidence.blocked_reasons, ["untrusted_runtime_evidence"]);

const fixtureOnly = evaluate({
  repositories: readyProbeA.repositories,
  runtime_evidence: { kind: "fixture", observed_at: OBSERVED_AT },
});
assert.equal(fixtureOnly.decision, "degraded");
assert.deepEqual(fixtureOnly.blocked_reasons, ["fixture_only_runtime_evidence"]);

const stale = evaluate(probe(sessionA, "2026-08-06T11:30:00.000Z"));
assert.equal(stale.decision, "degraded");
assert.deepEqual(stale.blocked_reasons, ["runtime_evidence_stale"]);
assert.equal(stale.freshness.state, "stale");

const invalidTimestamp = evaluate(probe(sessionA, "not-a-date"));
assert.equal(invalidTimestamp.decision, "degraded");
assert.deepEqual(invalidTimestamp.blocked_reasons, ["runtime_evidence_timestamp_invalid"]);
assert.equal(invalidTimestamp.freshness.state, "invalid");

const nonIsoTimestamp = evaluate(probe(sessionA, "2026-08-06"));
assert.equal(nonIsoTimestamp.decision, "degraded");
assert.deepEqual(nonIsoTimestamp.blocked_reasons, ["runtime_evidence_timestamp_invalid"]);
assert.equal(nonIsoTimestamp.freshness.state, "invalid");

const futureTimestamp = evaluate(probe(sessionA, "2026-08-06T12:01:00.000Z"));
assert.equal(futureTimestamp.decision, "degraded");
assert.deepEqual(futureTimestamp.blocked_reasons, ["runtime_evidence_from_future"]);
assert.equal(futureTimestamp.freshness.state, "future");

const digestMismatchProbe = probe(sessionA);
digestMismatchProbe.repositories[0].local_head = "0".repeat(40);
const digestMismatch = evaluate(digestMismatchProbe);
assert.equal(digestMismatch.decision, "degraded");
assert.deepEqual(digestMismatch.blocked_reasons, ["runtime_evidence_digest_mismatch"]);

const verifierMismatchProbe = probe(sessionA);
verifierMismatchProbe.runtime_evidence.verifier = "self_asserted_probe";
const verifierMismatch = evaluate(verifierMismatchProbe);
assert.equal(verifierMismatch.decision, "degraded");
assert.deepEqual(verifierMismatch.blocked_reasons, ["untrusted_runtime_evidence"]);

fs.writeFileSync(path.join(sessionA, "DIRTY.txt"), "preserve me\n");
const dirty = evaluate(probe(sessionA));
assert.equal(dirty.decision, "blocked");
assert.deepEqual(dirty.blocked_reasons, ["local_changes_present:canonical"]);
assert.equal(dirty.next_action.kind, "classify_local_changes");
assert.equal(dirty.write_boundary.forbidden.includes("git reset"), true);
fs.unlinkSync(path.join(sessionA, "DIRTY.txt"));

fs.writeFileSync(path.join(sessionA, "AHEAD.txt"), "ahead\n");
git(sessionA, ["add", "AHEAD.txt"]);
git(sessionA, ["commit", "-m", "ahead"]);
const ahead = evaluate(probe(sessionA));
assert.equal(ahead.decision, "blocked");
assert.deepEqual(ahead.blocked_reasons, ["upstream_not_in_sync:canonical:ahead"]);

git(sessionA, ["push", "origin", "HEAD"]);
git(sessionB, ["fetch", "origin"]);
const behind = evaluate(probe(sessionB));
assert.equal(behind.decision, "blocked");
assert.deepEqual(behind.blocked_reasons, ["upstream_not_in_sync:canonical:behind"]);

fs.writeFileSync(path.join(sessionB, "DIVERGED.txt"), "diverged\n");
git(sessionB, ["add", "DIVERGED.txt"]);
git(sessionB, ["commit", "-m", "diverged"]);
const diverged = evaluate(probe(sessionB));
assert.equal(diverged.decision, "blocked");
assert.deepEqual(diverged.blocked_reasons, ["upstream_not_in_sync:canonical:diverged"]);

const noOriginRoot = fs.mkdtempSync(path.join(os.tmpdir(), "jv45-no-origin-"));
git(noOriginRoot, ["init"]);
const noOrigin = evaluate(probe(noOriginRoot));
assert.equal(noOrigin.decision, "blocked");
assert.match(noOrigin.blocked_reasons[0], /^origin_missing:jv45-no-origin-/);

const localOnlyProbe = probeAccountLoginSyncStart({ root: sessionA, observedAt: OBSERVED_AT, probeRemote: false });
const localOnly = evaluate(localOnlyProbe);
assert.equal(localOnly.decision, "degraded");
assert.deepEqual(localOnly.blocked_reasons, ["remote_truth_not_probed:canonical"]);

const cliRoot = fs.mkdtempSync(path.join(os.tmpdir(), "jv45-cli-"));
git(cliRoot, ["clone", remoteRoot, "."]);
const cliProbe = spawnSync(process.execPath, [
  path.resolve("scripts", "account-login-sync-start.mjs"),
  "--probe",
  "--remote",
  "--root",
  cliRoot,
], { encoding: "utf-8" });
assert.equal(cliProbe.status, 0, cliProbe.stderr);
const cliResult = JSON.parse(cliProbe.stdout);
assert.equal(cliResult.decision, "ready");
assert.equal(cliResult.evidence.verifier_result, "safe_probe_verified");

const accountCli = spawnSync(process.execPath, [
  path.resolve("scripts", "account-login-sync-start.mjs"),
  "--probe",
  "--account-metadata",
  "ignored.json",
], { encoding: "utf-8" });
assert.equal(accountCli.status, 2);
assert.match(accountCli.stderr, /unsupported argument: --account-metadata/);

const source = fs.readFileSync(path.resolve("scripts", "account-login-sync-start.mjs"), "utf-8");
for (const command of ["fetch", "pull", "reset", "checkout", "commit", "push"]) {
  assert.equal(
    new RegExp(`git\\(resolvedRoot, \\[\\"${command}\\"`).test(source),
    false,
    `safe probe must not execute git ${command}`,
  );
}

console.log("Account login sync start verification OK");
