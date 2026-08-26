#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const admissionScript = path.join(repoRoot, "scripts", "project-write-admission.mjs");
const hookScript = path.join(repoRoot, "scripts", "project-write-hook.mjs");
const liveCollabRoot = path.dirname(repoRoot);
const morrowiseTasks = JSON.parse(fs.readFileSync(path.join(repoRoot, "milestones", "morrowise", "tasks.json"), "utf8"));
const jv43 = morrowiseTasks.tasks.find((task) => task.id === "project-topology-architecture-atlas");
for (const acceptanceId of ["A11｜", "A12｜", "A13｜"]) {
  assert.ok(jv43?.acceptance?.some((entry) => entry.startsWith(acceptanceId)), `JV-43 is missing ${acceptanceId}`);
}

for (const configPath of [path.join(liveCollabRoot, ".codex", "hooks.json"), path.join(liveCollabRoot, ".claude", "settings.json")]) {
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const groups = config.hooks?.PreToolUse || [];
  assert.ok(groups.some((group) => /apply_patch|Edit|Write/.test(group.matcher) && group.hooks?.some((hook) => hook.command?.includes("project-write-hook.mjs"))), `${configPath} does not wire the pre-write hook`);
}

withFixture(({ collabRoot, registryPath }) => {
  const canonical = path.join(collabRoot, "harness-mc", "fixture.txt");
  assertAllowed(runAdmission({ collabRoot, registryPath, destination: canonical }), "ready canonical destination");
});

withFixture(({ collabRoot, registryPath, records }) => {
  fs.mkdirSync(path.join(collabRoot, "needs-review"));
  records.push(record("needs-review", { classification: "unknown", migration_state: "not_assessed", project_home_ref: null, topology_profile: null, repo_ref: null }));
  writeRegistry(registryPath, records);
  const canonical = path.join(collabRoot, "harness-mc", "fixture.txt");
  const result = runAdmission({ collabRoot, registryPath, destination: canonical });
  assertAllowed(result, "unrelated attention must not block the canonical target");
  assert.equal(result.topology_status, "attention");
});

withFixture(({ collabRoot, registryPath }) => {
  fs.mkdirSync(path.join(collabRoot, "surprise"));
  const result = runAdmission({ collabRoot, registryPath, destination: path.join(collabRoot, "harness-mc", "fixture.txt") });
  assertAllowed(result, "unrelated unregistered root must not block the canonical target");
  assert.equal(result.topology_status, "blocked");
});

withFixture(({ collabRoot, registryPath, records }) => {
  records[0].last_verified_at = "2026-07-20";
  writeRegistry(registryPath, records);
  const result = runAdmission({ collabRoot, registryPath, destination: path.join(collabRoot, "harness-mc", "fixture.txt") });
  assertAllowed(result, "stale canonical evidence must remain a maintenance signal, not a write blocker");
  assert.equal(result.topology_status, "blocked");
});

withFixture(({ collabRoot, registryPath, records }) => {
  fs.mkdirSync(path.join(collabRoot, "unknown"));
  records.push(record("unknown", { classification: "unknown", migration_state: "not_assessed", project_home_ref: null, topology_profile: null, repo_ref: null }));
  writeRegistry(registryPath, records);
  assertBlocked(runAdmission({ collabRoot, registryPath, destination: path.join(collabRoot, "unknown", "file.txt") }), "target_not_canonical");
});

withFixture(({ collabRoot, registryPath }) => {
  fs.mkdirSync(path.join(collabRoot, "unregistered"));
  assertBlocked(runAdmission({ collabRoot, registryPath, destination: path.join(collabRoot, "unregistered", "file.txt") }), "target_topology_blocked");
  assertBlocked(runAdmission({ collabRoot, registryPath, destination: path.resolve(collabRoot, "..", "escaped.txt") }), "destination_outside_collab");
});

withFixture(({ collabRoot, registryPath }) => {
  const canonical = path.join(collabRoot, "harness-mc", "fixture.txt");
  fs.writeFileSync(canonical, "before\n");
  const canonicalPatch = patchFor(canonical, "before", "after");
  const hook = runHook({ collabRoot, registryPath, patch: canonicalPatch });
  assert.equal(hook.status, 0, hook.stderr);

  const applyPatchBin = process.env.APPLY_PATCH_BIN || findExecutable("apply_patch");
  assert.ok(applyPatchBin, "actual apply_patch executable is required for the integration fixture");
  const applied = spawnSync(applyPatchBin, [canonicalPatch], { cwd: collabRoot, encoding: "utf8" });
  assert.equal(applied.status, 0, applied.stderr || applied.stdout);
  assert.equal(fs.readFileSync(canonical, "utf8"), "after\n");

  for (const destination of [
    path.join(collabRoot, "unknown", "blocked.txt"),
    path.join(collabRoot, "unregistered", "blocked.txt"),
    path.resolve(collabRoot, "..", "escaped.txt"),
  ]) {
    if (destination.includes(`${path.sep}unknown${path.sep}`)) {
      fs.mkdirSync(path.join(collabRoot, "unknown"), { recursive: true });
      const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
      registry.records.push(record("unknown", { classification: "unknown", migration_state: "not_assessed", project_home_ref: null, topology_profile: null, repo_ref: null }));
      writeRegistry(registryPath, registry.records);
    }
    const beforeDigest = digestTree(collabRoot);
    const denied = runHook({ collabRoot, registryPath, patch: addPatchFor(destination) });
    assert.equal(denied.status, 2, `hook must reject ${destination}: ${denied.stderr}`);
    assert.equal(digestTree(collabRoot), beforeDigest, `rejected destination changed fixture digest: ${destination}`);
  }
});

console.log("Project write admission and apply_patch hook verification OK — JV43-A12=pass");

function withFixture(callback) {
  const fixtureParent = fs.mkdtempSync(path.join(os.tmpdir(), "project-write-admission-"));
  const collabRoot = path.join(fixtureParent, "collab");
  const canonicalRoot = path.join(collabRoot, "harness-mc");
  fs.mkdirSync(canonicalRoot, { recursive: true });
  fs.writeFileSync(path.join(canonicalRoot, "fixture.txt"), "fixture\n");
  const registryPath = path.join(fixtureParent, "topology.json");
  const records = [record("harness-mc")];
  writeRegistry(registryPath, records);
  try {
    callback({ fixtureParent, collabRoot, registryPath, records });
  } finally {
    fs.rmSync(fixtureParent, { recursive: true, force: true });
  }
}

function runAdmission({ collabRoot, registryPath, destination }) {
  const execution = spawnSync(process.execPath, [admissionScript, "--collab-root", collabRoot, "--registry", registryPath, "--destination", destination, "--format", "json"], { encoding: "utf8" });
  assert.notEqual(execution.status, null, execution.stderr);
  return { process_status: execution.status, ...JSON.parse(execution.stdout) };
}

function runHook({ collabRoot, registryPath, patch }) {
  return spawnSync(process.execPath, [hookScript], {
    cwd: collabRoot,
    encoding: "utf8",
    input: JSON.stringify({ hook_event_name: "PreToolUse", cwd: collabRoot, tool_name: "apply_patch", tool_input: { command: patch } }),
    env: { ...process.env, COLLAB_ROOT: collabRoot, PROJECT_TOPOLOGY_REGISTRY: registryPath },
  });
}

function assertAllowed(result, label) {
  assert.equal(result.process_status, 0, `${label}: ${JSON.stringify(result)}`);
  assert.equal(result.allowed, true, label);
}

function assertBlocked(result, code) {
  assert.equal(result.process_status, 2, JSON.stringify(result));
  assert.equal(result.allowed, false);
  assert.equal(result.code, code);
}

function record(name, overrides = {}) {
  return {
    id: name,
    path_label: `$COLLAB/${name}`,
    classification: "canonical_project",
    migration_state: "inventory_only",
    project_home_ref: `$COLLAB/${name}`,
    topology_profile: "git-repository",
    document_ref: null,
    repo_ref: `$COLLAB/${name}`,
    evidence: [`$COLLAB/${name}`],
    last_verified_at: "2026-08-02",
    notes: "fixture",
    ...overrides,
  };
}

function writeRegistry(registryPath, records) {
  fs.writeFileSync(registryPath, `${JSON.stringify({
    registry_id: "morrowise-project-topology.v1",
    maintenance_policy: { startup_command: "npm run health:project-topology", evidence_warn_after_days: 30, startup_rule: "blocked integrity findings stop mutation" },
    records,
  })}\n`);
}

function patchFor(destination, before, after) {
  return `*** Begin Patch\n*** Update File: ${destination}\n@@\n-${before}\n+${after}\n*** End Patch`;
}

function addPatchFor(destination) {
  return `*** Begin Patch\n*** Add File: ${destination}\n+blocked\n*** End Patch`;
}

function findExecutable(command) {
  const result = spawnSync("sh", ["-lc", `command -v ${command}`], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

function digestTree(root) {
  const hash = crypto.createHash("sha256");
  walk(root, hash, root);
  return hash.digest("hex");
}

function walk(current, hash, root) {
  for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = path.join(current, entry.name);
    const relative = path.relative(root, absolute);
    hash.update(`${entry.isDirectory() ? "d" : "f"}:${relative}\0`);
    if (entry.isDirectory()) walk(absolute, hash, root);
    else if (entry.isFile()) hash.update(fs.readFileSync(absolute));
  }
}
