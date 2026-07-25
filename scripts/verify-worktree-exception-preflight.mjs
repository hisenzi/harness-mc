#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { decideWorktreeMode } from "./worktree-exception-preflight.mjs";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));

function runCli(...args) {
  return spawnSync(process.execPath, ["scripts/worktree-exception-preflight.mjs", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

const sequential = decideWorktreeMode({
  reason: "sequential_single_task",
  intent: "implementation",
});
assert.equal(sequential.decision, "allow");
assert.equal(sequential.worktree_allowed, false);
assert.equal(sequential.recommended_mode, "branch");
assert.match(sequential.next_action, /一般 branch/);

const unrelatedDirty = decideWorktreeMode({
  reason: "known_unrelated_dirty",
  intent: "implementation",
});
assert.equal(unrelatedDirty.decision, "allow");
assert.equal(unrelatedDirty.worktree_allowed, false);
assert.equal(unrelatedDirty.recommended_mode, "branch_with_exclusions");

const overlapUnknown = decideWorktreeMode({
  reason: "unknown_or_overlapping_dirty",
  intent: "implementation",
});
assert.equal(overlapUnknown.decision, "blocked");
assert.equal(overlapUnknown.recommended_mode, "classify_or_escalate");

const concurrent = decideWorktreeMode({
  reason: "concurrent_active_work",
  intent: "implementation",
});
assert.equal(concurrent.decision, "blocked");
assert.match(concurrent.next_action, /evidence_ref/);

const concurrentWithEvidence = decideWorktreeMode({
  reason: "concurrent_active_work",
  intent: "implementation",
  evidenceRef: "Vincent 2026-07-25: two active task branches have non-overlapping scopes",
});
assert.equal(concurrentWithEvidence.decision, "allow");
assert.equal(concurrentWithEvidence.worktree_allowed, true);
assert.equal(concurrentWithEvidence.topology_required, true);
assert.equal(concurrentWithEvidence.recommended_mode, "worktree");

assert.throws(
  () => decideWorktreeMode({ reason: "concurrent_active_work", intent: "unsupported" }),
  /unsupported worktree intent/,
);

const hotfix = decideWorktreeMode({
  reason: "urgent_hotfix_with_uncommitted_work",
  intent: "implementation",
  evidenceRef: "incident MW-2026-07-25: production hotfix must preserve uncommitted task work",
});
assert.equal(hotfix.decision, "allow");
assert.equal(hotfix.recommended_mode, "worktree");

const freshVerification = decideWorktreeMode({
  reason: "fresh_baseline_verification",
  intent: "implementation",
  evidenceRef: "verify fresh baseline",
});
assert.equal(freshVerification.decision, "blocked");
assert.equal(freshVerification.recommended_mode, "verification_only_worktree");

const verifyOnly = decideWorktreeMode({
  reason: "fresh_baseline_verification",
  intent: "verification",
  evidenceRef: "run isolated verifier baseline",
});
assert.equal(verifyOnly.decision, "allow");
assert.equal(verifyOnly.recommended_mode, "verification_only_worktree");

const explicit = decideWorktreeMode({
  reason: "explicit_vincent_request",
  intent: "implementation",
});
assert.equal(explicit.decision, "blocked");

const explicitWithEvidence = decideWorktreeMode({
  reason: "explicit_vincent_request",
  intent: "implementation",
  evidenceRef: "Vincent 2026-07-25: use a worktree for this explicitly isolated task",
});
assert.equal(explicitWithEvidence.decision, "allow");
assert.equal(explicitWithEvidence.recommended_mode, "worktree");

assert.throws(
  () => decideWorktreeMode({ reason: "feature_work", intent: "implementation" }),
  /unsupported worktree exception reason/,
);

const cliBlocked = runCli("--reason", "sequential_single_task", "--intent", "implementation", "--json");
assert.equal(cliBlocked.status, 0);
assert.match(cliBlocked.stdout, /"decision": "allow"/);
assert.match(cliBlocked.stdout, /"worktree_allowed": false/);
assert.match(cliBlocked.stdout, /"recommended_mode": "branch"/);

const cliNeedsEvidence = runCli("--reason", "concurrent_active_work", "--intent", "implementation", "--json");
assert.equal(cliNeedsEvidence.status, 2);
assert.match(cliNeedsEvidence.stdout, /"decision": "blocked"/);

const cliVerificationOnly = runCli("--reason", "fresh_baseline_verification", "--intent", "verification", "--evidence-ref", "run isolated verifier baseline", "--json");
assert.equal(cliVerificationOnly.status, 0);
assert.match(cliVerificationOnly.stdout, /"recommended_mode": "verification_only_worktree"/);

const cliUnsupportedIntent = runCli("--reason", "concurrent_active_work", "--intent", "unsupported", "--evidence-ref", "test", "--json");
assert.equal(cliUnsupportedIntent.status, 64);
assert.match(cliUnsupportedIntent.stderr, /unsupported worktree intent/);

console.log("Worktree exception preflight verification OK");
