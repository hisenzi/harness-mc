import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import {
  evaluateAccountLoginSyncStart,
  probeAccountLoginSyncStart,
} from "./account-login-sync-start.mjs";

function cleanInput(overrides = {}) {
  return {
    account_metadata: {
      schema_version: "account-login-sync-start.v1",
      approval: {
        approved_by: "Vincent",
        approved_at: "2026-08-03",
      },
      required_capabilities: [
        { id: "git-remote-access", status: "available" },
        { id: "agent-session", status: "available" },
      ],
    },
    repositories: [
      {
        id: "harness-mc",
        origin_configured: true,
        local_state: "clean",
        upstream_state: "in_sync",
      },
    ],
    runtime_evidence: {
      kind: "safe_probe",
      observed_at: "2026-08-03T00:00:00.000Z",
    },
    ...overrides,
  };
}

const missingAccount = evaluateAccountLoginSyncStart(cleanInput({
  account_metadata: {
    schema_version: "account-login-sync-start.v1",
    approval: { approved_by: "Vincent", approved_at: "2026-08-03" },
    required_capabilities: [{ id: "git-remote-access", status: "missing" }],
  },
}));
assert.equal(missingAccount.decision, "blocked");
assert.deepEqual(missingAccount.blocked_reasons, ["required_capability_missing:git-remote-access"]);
assert.equal(missingAccount.next_action.kind, "account_login_or_capability_check");

const dirtyRepo = evaluateAccountLoginSyncStart(cleanInput({
  repositories: [{
    id: "harness-mc",
    origin_configured: true,
    local_state: "dirty",
    upstream_state: "in_sync",
  }],
}));
assert.equal(dirtyRepo.decision, "blocked");
assert.deepEqual(dirtyRepo.blocked_reasons, ["local_changes_present:harness-mc"]);
assert.equal(dirtyRepo.next_action.kind, "classify_local_changes");
assert.equal(dirtyRepo.write_boundary.forbidden.includes("git reset"), true);

assert.throws(
  () => evaluateAccountLoginSyncStart(cleanInput({
    account_metadata: {
      schema_version: "account-login-sync-start.v1",
      approval: { approved_by: "Vincent", approved_at: "2026-08-03" },
      required_capabilities: [{ id: "git-remote-access", status: "available", token: "must-not-be-accepted" }],
    },
  })),
  /unsupported or secret-bearing account metadata field: token/,
);

const fixtureOnly = evaluateAccountLoginSyncStart(cleanInput({
  runtime_evidence: { kind: "fixture", observed_at: "2026-08-03T00:00:00.000Z" },
}));
assert.equal(fixtureOnly.decision, "degraded");
assert.deepEqual(fixtureOnly.blocked_reasons, ["fixture_only_runtime_evidence"]);
assert.equal(fixtureOnly.next_action.kind, "run_safe_probe");

const first = evaluateAccountLoginSyncStart(cleanInput());
const second = evaluateAccountLoginSyncStart(cleanInput());
assert.deepEqual(first, second, "same sanitized input must produce a deterministic decision");
assert.equal(first.decision, "ready");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "account-login-sync-start-"));
execFileSync("git", ["init"], { cwd: tmpRoot, stdio: "ignore" });
execFileSync("git", ["config", "user.email", "verify@example.test"], { cwd: tmpRoot });
execFileSync("git", ["config", "user.name", "JV-45 Verify"], { cwd: tmpRoot });
fs.writeFileSync(path.join(tmpRoot, "README.md"), "fixture\n");
execFileSync("git", ["add", "README.md"], { cwd: tmpRoot });
execFileSync("git", ["commit", "-m", "seed"], { cwd: tmpRoot, stdio: "ignore" });
execFileSync("git", ["remote", "add", "origin", "https://example.invalid/harness-mc.git"], { cwd: tmpRoot });

const probe = probeAccountLoginSyncStart({
  root: tmpRoot,
  accountMetadata: cleanInput().account_metadata,
  observedAt: "2026-08-03T00:00:00.000Z",
});
assert.equal(probe.runtime_evidence.kind, "safe_probe");
assert.equal(probe.repositories[0].origin_configured, true);
assert.equal(probe.repositories[0].local_state, "clean");
assert.equal(probe.repositories[0].upstream_state, "unknown");
const probeDecision = evaluateAccountLoginSyncStart(probe);
assert.equal(probeDecision.decision, "degraded", "local metadata alone must not claim remote freshness");
assert.deepEqual(probeDecision.blocked_reasons, ["upstream_state_unknown:harness-mc"]);
assert.equal(probeDecision.next_action.kind, "run_read_only_remote_probe");
assert.equal(JSON.stringify(probeDecision).includes("example.invalid"), false, "origin URLs must not be emitted");

const cliProbe = spawnSync(process.execPath, [
  path.resolve("scripts", "account-login-sync-start.mjs"),
  "--probe",
  "--root",
  tmpRoot,
], { encoding: "utf-8" });
assert.equal(cliProbe.status, 2, "a probe without approved account metadata must return blocked exit status");
const cliResult = JSON.parse(cliProbe.stdout);
assert.equal(cliResult.decision, "blocked");
assert.deepEqual(cliResult.blocked_reasons, ["account_metadata_missing"]);

const remoteRoot = fs.mkdtempSync(path.join(os.tmpdir(), "account-login-sync-remote-"));
execFileSync("git", ["init", "--bare"], { cwd: remoteRoot, stdio: "ignore" });
const remoteProbeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "account-login-sync-probe-"));
execFileSync("git", ["init"], { cwd: remoteProbeRoot, stdio: "ignore" });
execFileSync("git", ["config", "user.email", "verify@example.test"], { cwd: remoteProbeRoot });
execFileSync("git", ["config", "user.name", "JV-45 Verify"], { cwd: remoteProbeRoot });
fs.writeFileSync(path.join(remoteProbeRoot, "README.md"), "remote fixture\n");
execFileSync("git", ["add", "README.md"], { cwd: remoteProbeRoot });
execFileSync("git", ["commit", "-m", "seed"], { cwd: remoteProbeRoot, stdio: "ignore" });
execFileSync("git", ["remote", "add", "origin", remoteRoot], { cwd: remoteProbeRoot });
execFileSync("git", ["push", "-u", "origin", "HEAD"], { cwd: remoteProbeRoot, stdio: "ignore" });
const remoteBranch = execFileSync("git", ["branch", "--show-current"], { cwd: remoteProbeRoot, encoding: "utf-8" }).trim();
execFileSync("git", ["update-ref", "-d", `refs/remotes/origin/${remoteBranch}`], { cwd: remoteProbeRoot });
const remoteProbe = probeAccountLoginSyncStart({
  root: remoteProbeRoot,
  accountMetadata: cleanInput().account_metadata,
  observedAt: "2026-08-03T00:00:00.000Z",
  probeRemote: true,
});
assert.equal(remoteProbe.repositories[0].upstream_state, "in_sync", "explicit read-only remote probe must compare local HEAD with origin");
assert.equal(evaluateAccountLoginSyncStart(remoteProbe).decision, "ready");
assert.equal(JSON.stringify(remoteProbe).includes(remoteRoot), false, "remote path must not be emitted");

console.log("Account login sync start verification OK");
