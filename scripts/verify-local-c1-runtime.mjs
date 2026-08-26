import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  acquireLocalC1Lock,
  commitLocalC1,
  listLocalC1Receipts,
  readLocalC1Receipt,
  recordLocalC1Receipt,
  releaseLocalC1Lock,
  validateLocalC1Receipt,
} from "./lib/repo-coordination-runtime.mjs";

const cases = [
  ["records a complete local C1 receipt without a remote", recordsCompleteLocalC1Receipt],
  ["rejects every mandatory local C1 receipt field", rejectsMissingReceiptFields],
  ["rejects a failed verifier before staging or committing", rejectsFailedVerifier],
  ["rejects a receipt whose paths differ from its C1", rejectsScopeMismatch],
  ["serializes two local C1 sessions without cross-scope commits", serializesConcurrentSessions],
  ["rejects terminal state in a local C1 receipt", rejectsTerminalState],
  ["creates a local C1 through the JV-37 CLI without a remote", createsLocalC1ThroughCli],
];

for (const [name, verify] of cases) {
  await verify();
  console.log(`PASS ${name}`);
}

function recordsCompleteLocalC1Receipt() {
  const fixture = createFixture("complete");
  try {
    fs.writeFileSync(path.join(fixture.repo, "owned-a.txt"), "A\n");
    const result = commitLocalC1({
      ...localC1Input(fixture, "event-owned-a", ["owned-a.txt"]),
      message: "feat(jv37): record local C1 receipt",
    });
    assert.equal(result.decision, "READY", result.details);
    assert.equal(result.receipt.state, "committed_local");
    assert.equal(result.receipt.pending_delivery, true);
    assert.equal(result.receipt.base_sha, fixture.baseSha);
    assert.deepEqual(commitPaths(fixture.repo, result.receipt.c1_sha), ["owned-a.txt"]);
    assert.deepEqual(readLocalC1Receipt({ repoPath: fixture.repo, c1Sha: result.receipt.c1_sha }), result.receipt);
    assert.deepEqual(listLocalC1Receipts({ repoPath: fixture.repo }).map((receipt) => receipt.event_id), ["event-owned-a"]);
    assert.equal(git(fixture.repo, ["remote"]).stdout.trim(), "", "fixture has no remote; local C1 must not require one");
  } finally {
    fixture.cleanup();
  }
}

function rejectsMissingReceiptFields() {
  const receipt = validReceipt();
  for (const field of ["event_id", "project_id", "task_id", "session_id", "actor", "base_sha", "c1_sha", "scope_paths", "verifier", "verified_at"]) {
    const candidate = structuredClone(receipt);
    delete candidate[field];
    const result = validateLocalC1Receipt(candidate);
    assert.equal(result.decision, "BLOCKED", `${field} must be required`);
    assert.equal(result.reason, "local_c1_receipt_invalid");
    assert.match(result.details || "", new RegExp(`\\b${field}\\b`));
  }
}

function rejectsFailedVerifier() {
  const fixture = createFixture("failed-verifier");
  try {
    fs.writeFileSync(path.join(fixture.repo, "owned.txt"), "owned\n");
    const result = commitLocalC1({
      ...localC1Input(fixture, "event-verifier-fails", ["owned.txt"]),
      message: "test: verifier failure must not commit",
      verifier: { id: "fixture-fail", command: process.execPath, args: ["-e", "process.exit(7)"] },
    });
    assert.equal(result.decision, "BLOCKED");
    assert.equal(result.reason, "local_c1_verifier_failed");
    assert.equal(revParse(fixture.repo, "HEAD"), fixture.baseSha, "failed verification must not commit");
    assert.deepEqual(listLocalC1Receipts({ repoPath: fixture.repo }), []);
  } finally {
    fixture.cleanup();
  }
}

function rejectsScopeMismatch() {
  const fixture = createFixture("scope-mismatch");
  try {
    fs.writeFileSync(path.join(fixture.repo, "owned.txt"), "owned\n");
    fs.writeFileSync(path.join(fixture.repo, "foreign.txt"), "foreign\n");
    git(fixture.repo, ["add", "owned.txt", "foreign.txt"]);
    git(fixture.repo, ["commit", "-m", "test: mixed C1"]);
    const result = recordLocalC1Receipt({
      ...localC1Input(fixture, "event-scope-mismatch", ["owned.txt"]),
      baseSha: fixture.baseSha,
      c1Sha: revParse(fixture.repo, "HEAD"),
      verifier: passedVerifierEvidence(),
    });
    assert.equal(result.decision, "BLOCKED");
    assert.equal(result.reason, "local_c1_scope_mismatch");
    assert.deepEqual(listLocalC1Receipts({ repoPath: fixture.repo }), []);
  } finally {
    fixture.cleanup();
  }
}

function serializesConcurrentSessions() {
  const fixture = createFixture("concurrency");
  try {
    const held = acquireLocalC1Lock({ repoPath: fixture.repo, sessionId: "session-a" });
    assert.equal(held.decision, "READY");
    const blocked = acquireLocalC1Lock({ repoPath: fixture.repo, sessionId: "session-b" });
    assert.equal(blocked.decision, "BLOCKED");
    assert.equal(blocked.reason, "local_c1_lock_unavailable");
    assert.equal(releaseLocalC1Lock({ repoPath: fixture.repo, sessionId: "session-a" }).decision, "READY");

    fs.writeFileSync(path.join(fixture.repo, "session-a.txt"), "A\n");
    const first = commitLocalC1({
      ...localC1Input(fixture, "event-session-a", ["session-a.txt"]),
      sessionId: "session-a",
      message: "test: session A local C1",
    });
    assert.equal(first.decision, "READY", first.details);

    fs.writeFileSync(path.join(fixture.repo, "session-b.txt"), "B\n");
    const second = commitLocalC1({
      ...localC1Input(fixture, "event-session-b", ["session-b.txt"]),
      sessionId: "session-b",
      message: "test: session B local C1",
    });
    assert.equal(second.decision, "READY", second.details);
    assert.deepEqual(commitPaths(fixture.repo, first.receipt.c1_sha), ["session-a.txt"]);
    assert.deepEqual(commitPaths(fixture.repo, second.receipt.c1_sha), ["session-b.txt"]);
    assert.deepEqual(listLocalC1Receipts({ repoPath: fixture.repo }).map((receipt) => receipt.event_id).sort(), ["event-session-a", "event-session-b"]);
  } finally {
    fixture.cleanup();
  }
}

function rejectsTerminalState() {
  const receipt = { ...validReceipt(), state: "completed" };
  const result = validateLocalC1Receipt(receipt);
  assert.equal(result.decision, "BLOCKED");
  assert.equal(result.reason, "local_c1_terminal_state_forbidden");
}

function createsLocalC1ThroughCli() {
  const fixture = createFixture("cli");
  try {
    fs.writeFileSync(path.join(fixture.repo, "cli-owned.txt"), "CLI\n");
    const runtime = fileURLToPath(new URL("./repo-coordination-runtime.mjs", import.meta.url));
    const result = spawnSync(process.execPath, [
      runtime,
      "local-c1-commit",
      "--repo", fixture.repo,
      "--event", "event-cli",
      "--project", "morrowise",
      "--task", "multi-machine-repo-coordination-gate",
      "--session", "cli-session",
      "--actor", "fixture-agent",
      "--message", "test: create local C1 through CLI",
      "--scope-path", "cli-owned.txt",
      "--verifier-id", "fixture-pass",
      "--verifier-command", process.execPath,
      "--verifier-arg", "-e",
      "--verifier-arg", "process.exit(0)",
    ], { cwd: fixture.repo, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.decision, "READY");
    assert.equal(receipt.receipt.event_id, "event-cli");
    assert.deepEqual(commitPaths(fixture.repo, receipt.receipt.c1_sha), ["cli-owned.txt"]);
  } finally {
    fixture.cleanup();
  }
}

function createFixture(name) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), `jv37-local-c1-${name}-`));
  git(repo, ["init", "-b", "main"]);
  git(repo, ["config", "user.name", "JV-37 fixture"]);
  git(repo, ["config", "user.email", "jv37-fixture@local.invalid"]);
  fs.writeFileSync(path.join(repo, "README.md"), "fixture\n");
  git(repo, ["add", "README.md"]);
  git(repo, ["commit", "-m", "test: baseline"]);
  return { repo, baseSha: revParse(repo, "HEAD"), cleanup: () => fs.rmSync(repo, { recursive: true, force: true }) };
}

function localC1Input(fixture, eventId, scopePaths) {
  return {
    repoPath: fixture.repo,
    eventId,
    projectId: "morrowise",
    taskId: "multi-machine-repo-coordination-gate",
    sessionId: "fixture-session",
    actor: "fixture-agent",
    scopePaths,
    verifier: { id: "fixture-pass", command: process.execPath, args: ["-e", "process.exit(0)"] },
  };
}

function validReceipt() {
  return {
    version: 1,
    event_id: "event-valid",
    project_id: "morrowise",
    task_id: "multi-machine-repo-coordination-gate",
    session_id: "fixture-session",
    actor: "fixture-agent",
    base_sha: "a".repeat(40),
    c1_sha: "b".repeat(40),
    scope_paths: ["owned.txt"],
    verifier: passedVerifierEvidence(),
    verified_at: "2026-08-26T00:00:00.000Z",
    state: "committed_local",
    pending_delivery: true,
  };
}

function passedVerifierEvidence() {
  return { id: "fixture-pass", command: process.execPath, args: ["-e", "process.exit(0)"], status: "passed", output_sha256: "a".repeat(64) };
}

function commitPaths(repoPath, sha) {
  return git(repoPath, ["diff-tree", "--no-commit-id", "--name-only", "-r", sha]).stdout.trim().split(/\r?\n/).filter(Boolean).sort();
}

function revParse(repoPath, ref) {
  return git(repoPath, ["rev-parse", ref]).stdout.trim();
}

function git(repoPath, args) {
  const result = spawnSync("git", args, { cwd: repoPath, encoding: "utf8" });
  assert.equal(result.status, 0, `${args.join(" ")}\n${result.stderr || result.stdout}`);
  return { stdout: result.stdout || "", stderr: result.stderr || "" };
}
