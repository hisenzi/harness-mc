#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const initScript = path.join(repoRoot, "scripts", "new-project.py");
const failures = [];

await check("success", () => {
  const fixture = makeFixture("success");
  try {
    const result = runQuick(fixture);
    assertArtifacts(fixture);
    const receipt = expectReceipt(result, "created");
    assert.equal(receipt.target_status, "ready");
    assert.equal(receipt.global_status, "ready");
    assert.equal(typeof receipt.duration_ms, "number");
    assert.deepEqual(receipt.maintenance_findings, []);
    assertArtifacts(fixture);
  } finally {
    fixture.cleanup();
  }
});

await check("invalid-input", () => {
  const fixture = makeFixture("invalid-input");
  try {
    const before = digest(fixture.collabRoot);
    const args = quickArgs(fixture, fixture.projectFolder);
    args[args.indexOf("--name") + 1] = "";
    const result = spawnSync("python3", args, { cwd: repoRoot, encoding: "utf8", env: fixture.env });
    const receipt = expectReceipt(result, "rejected");
    assert.equal(receipt.reason_code, "invalid_input");
    assert.equal(digest(fixture.collabRoot), before, "invalid input must not change fixture state");
  } finally {
    fixture.cleanup();
  }
});

await check("invalid-topology-registry", () => {
  const fixture = makeFixture("invalid-topology-registry");
  try {
    const registry = JSON.parse(fs.readFileSync(fixture.topologyRegistry, "utf8"));
    registry.registry_id = "invalid-registry";
    fs.writeFileSync(fixture.topologyRegistry, `${JSON.stringify(registry, null, 2)}\n`);
    const before = digest(fixture.collabRoot);
    const receipt = expectReceipt(runQuick(fixture), "rejected");
    assert.equal(receipt.reason_code, "transaction_failed");
    assert.equal(receipt.global_status, "degraded");
    assert.equal(digest(fixture.collabRoot), before);
  } finally {
    fixture.cleanup();
  }
});

for (const conflict of ["id", "folder", "readme", "milestone"]) {
  await check(`${conflict}-conflict`, () => {
    const fixture = makeFixture(`${conflict}-conflict`);
    try {
      createConflict(fixture, conflict);
      if (conflict === "id") fs.mkdirSync(path.join(fixture.collabRoot, "unrelated-maintenance-root"));
      const before = digest(fixture.collabRoot);
      const receipt = expectReceipt(runQuick(fixture), "rejected");
      assert.equal(receipt.reason_code, `${conflict === "id" ? "id" : conflict === "folder" ? "project_folder" : conflict}_conflict`);
      if (conflict === "id") {
        assert.equal(receipt.global_status, "degraded", "rejected Quick must still expose global maintenance");
        assert.ok(receipt.maintenance_findings.length > 0);
      }
      assert.equal(digest(fixture.collabRoot), before, `${conflict} conflict must not change fixture state`);
    } finally {
      fixture.cleanup();
    }
  });
}

await check("path-escape", () => {
  const fixture = makeFixture("path-escape");
  try {
    const before = digest(fixture.collabRoot);
    const receipt = expectReceipt(runQuick(fixture, { projectFolder: path.join(fixture.root, "outside") }), "rejected");
    assert.equal(receipt.reason_code, "destination_path_escape");
    assert.equal(digest(fixture.collabRoot), before);
  } finally {
    fixture.cleanup();
  }
});

await check("symlink-escape", () => {
  const fixture = makeFixture("symlink-escape");
  try {
    const outside = path.join(fixture.root, "outside");
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, fixture.projectFolder);
    const before = digest(fixture.collabRoot);
    const receipt = expectReceipt(runQuick(fixture), "rejected");
    assert.equal(receipt.reason_code, "destination_symlink_escape");
    assert.equal(digest(fixture.collabRoot), before);
  } finally {
    fixture.cleanup();
  }
});

await check("milestone-root-escape", () => {
  const fixture = makeFixture("milestone-root-escape");
  try {
    const before = digest(fixture.collabRoot);
    const receipt = expectReceipt(runQuick(fixture, { milestonesRoot: path.join(fixture.root, "outside-milestones") }), "rejected");
    assert.equal(receipt.reason_code, "destination_path_escape");
    assert.equal(digest(fixture.collabRoot), before);
  } finally {
    fixture.cleanup();
  }
});

await check("topology-registry-escape", () => {
  const fixture = makeFixture("topology-registry-escape");
  try {
    const outsideRegistry = path.join(fixture.root, "outside-topology.json");
    fs.copyFileSync(fixture.topologyRegistry, outsideRegistry);
    const before = digest(fixture.collabRoot);
    const receipt = expectReceipt(runQuick(fixture, { topologyRegistry: outsideRegistry }), "rejected");
    assert.equal(receipt.reason_code, "destination_path_escape");
    assert.equal(digest(fixture.collabRoot), before);
  } finally {
    fixture.cleanup();
  }
});

await check("milestone-root-symlink", () => {
  const fixture = makeFixture("milestone-root-symlink");
  try {
    const outside = path.join(fixture.root, "outside-milestones");
    fs.mkdirSync(outside);
    fs.rmSync(fixture.milestonesRoot, { recursive: true, force: true });
    fs.symlinkSync(outside, fixture.milestonesRoot);
    const before = digest(fixture.collabRoot);
    const receipt = expectReceipt(runQuick(fixture), "rejected");
    assert.equal(receipt.reason_code, "destination_symlink_escape");
    assert.equal(digest(fixture.collabRoot), before);
  } finally {
    fixture.cleanup();
  }
});

await check("target-not-canonical", () => {
  const fixture = makeFixture("target-not-canonical");
  try {
    const registry = JSON.parse(fs.readFileSync(fixture.topologyRegistry, "utf8"));
    registry.records.push({
      ...topologyFixture().records[0],
      id: fixture.id,
      path_label: `$COLLAB/${fixture.id}`,
      project_home_ref: `$COLLAB/${fixture.id}`,
      classification: "legacy_root",
    });
    fs.writeFileSync(fixture.topologyRegistry, `${JSON.stringify(registry, null, 2)}\n`);
    const before = digest(fixture.collabRoot);
    const receipt = expectReceipt(runQuick(fixture), "rejected");
    assert.equal(receipt.reason_code, "target_not_canonical");
    assert.equal(digest(fixture.collabRoot), before);
  } finally {
    fixture.cleanup();
  }
});

await check("target-migration-blocked", () => {
  const fixture = makeFixture("target-migration-blocked");
  try {
    const registry = JSON.parse(fs.readFileSync(fixture.topologyRegistry, "utf8"));
    registry.records.push({
      ...topologyFixture().records[0],
      id: fixture.id,
      path_label: `$COLLAB/${fixture.id}`,
      project_home_ref: `$COLLAB/${fixture.id}`,
      migration_state: "blocked",
    });
    fs.writeFileSync(fixture.topologyRegistry, `${JSON.stringify(registry, null, 2)}\n`);
    const before = digest(fixture.collabRoot);
    const receipt = expectReceipt(runQuick(fixture), "rejected");
    assert.equal(receipt.reason_code, "target_migration_blocked");
    assert.equal(digest(fixture.collabRoot), before);
  } finally {
    fixture.cleanup();
  }
});

await check("global-degraded", () => {
  const fixture = makeFixture("global-degraded");
  try {
    fs.mkdirSync(path.join(fixture.collabRoot, "unrelated-maintenance-root"));
    const receipt = expectReceipt(runQuick(fixture), "created");
    assert.equal(receipt.target_status, "ready");
    assert.equal(receipt.global_status, "degraded");
    assert.ok(receipt.maintenance_findings.length > 0);
  } finally {
    fixture.cleanup();
  }
});

await check("mid-write-failure", () => {
  const fixture = makeFixture("mid-write-failure", { milestonesAsFile: true });
  try {
    const before = digest(fixture.collabRoot);
    const receipt = expectReceipt(runQuick(fixture), "rejected");
    assert.equal(receipt.reason_code, "transaction_failed");
    assert.equal(digest(fixture.collabRoot), before, "failed Quick must roll back every write");
  } finally {
    fixture.cleanup();
  }
});

for (const phase of ["project_folder", "milestone", "topology"]) {
  await check(`interrupted-transaction-${phase}`, () => {
    const fixture = makeFixture(`interrupted-transaction-${phase}`);
    try {
      const before = digest(fixture.collabRoot);
      const transactionDir = path.join(fixture.collabRoot, ".quick-transactions");
      const interrupted = runQuick(fixture, { env: { MORROWISE_QUICK_TEST_INTERRUPT_AFTER: phase } });
      assert.equal(interrupted.status, 91, `fixture hook must interrupt after the ${phase} commit: ${interrupted.stdout} ${interrupted.stderr}`);
      assert.ok(fs.existsSync(transactionDir), "an interrupted process must leave the recovery journal");
      const receipt = expectReceipt(runQuick(fixture), "rejected");
      assert.equal(receipt.reason_code, "transaction_interrupted");
      assert.equal(fs.existsSync(transactionDir), false, "recovery must remove an unfinished transaction journal");
      assert.equal(digest(fixture.collabRoot), before, "recovery must restore every partially committed output");
    } finally {
      fixture.cleanup();
    }
  });
}

await check("concurrent-same-id-folder", async () => {
  const fixture = makeFixture("concurrent-same-id-folder");
  try {
    const [first, second] = await Promise.all([runQuickAsync(fixture), runQuickAsync(fixture)]);
    const receipts = [first, second].map((result) => parseReceipt(result));
    const created = receipts.filter((receipt) => receipt.outcome === "created");
    const rejected = receipts.filter((receipt) => receipt.outcome === "rejected");
    assert.equal(created.length, 1, "exactly one concurrent Quick may create the project");
    assert.equal(rejected.length, 1, "the competing Quick must be rejected");
    assert.equal(rejected[0].reason_code, "transaction_unavailable");
    assertArtifacts(fixture);
  } finally {
    fixture.cleanup();
  }
});

await check("concurrent-distinct-candidates", async () => {
  const fixture = makeFixture("concurrent-distinct-candidates");
  try {
    const otherId = `${fixture.id}-other`;
    const otherFolder = path.join(fixture.collabRoot, otherId);
    const [first, second] = await Promise.all([
      runQuickAsync(fixture),
      runQuickAsync(fixture, { id: otherId, projectFolder: otherFolder }),
    ]);
    expectReceipt(first, "created");
    expectReceipt(second, "created");
    assert.ok(fs.existsSync(path.join(otherFolder, "README.md")));
    assert.ok(fs.existsSync(path.join(fixture.milestonesRoot, otherId, "tasks.json")));
  } finally {
    fixture.cleanup();
  }
});

await check("no-external-side-effects", () => {
  const fixture = makeFixture("no-external-side-effects", { commandTrap: true });
  try {
    const result = runQuick(fixture);
    assert.equal(fs.readFileSync(fixture.commandLog, "utf8"), "", "Quick must not call external commands");
    expectReceipt(result, "created");
    const rejected = runQuick(fixture);
    expectReceipt(rejected, "rejected");
    assert.equal(fs.readFileSync(fixture.commandLog, "utf8"), "", "rejected Quick must not call external commands");
  } finally {
    fixture.cleanup();
  }
});

await check("performance-20-runs", () => {
  const results = [];
  for (let index = 0; index < 20; index += 1) {
    const fixture = makeFixture(`performance-${index}`);
    try {
      const startedAt = process.hrtime.bigint();
      const result = runQuick(fixture);
      const wallMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      results.push({ result, wallMs });
    } finally {
      fixture.cleanup();
    }
  }
  const receiptDurations = results.map(({ result }) => expectReceipt(result, "created").duration_ms);
  const wallDurations = results.map(({ wallMs }) => wallMs);
  for (const durations of [receiptDurations, wallDurations]) {
    durations.sort((left, right) => left - right);
    const p95 = durations[Math.ceil(durations.length * 0.95) - 1];
    assert.ok(p95 <= 10_000, `p95 must be <= 10000ms, got ${p95}`);
  }
});

if (failures.length) {
  console.error(`Quick v2 contract RED — ${failures.length} fixture(s) failed:`);
  for (const failure of failures) console.error(`- ${failure.name}: ${failure.message}`);
  process.exitCode = 1;
} else {
  console.log("Quick v2 fixture verification passed — this is not 綠燈; also run verify-project-init-quick and the zero-side-effect check");
}

async function check(name, verification) {
  try {
    await verification();
  } catch (error) {
    failures.push({ name, message: error instanceof Error ? error.message : String(error) });
  }
}

function makeFixture(name, { milestonesAsFile = false, commandTrap = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `project-init-quick-v2-${name}-`));
  const collabRoot = path.join(root, "Claude_協作");
  const mcRoot = path.join(collabRoot, "harness-mc");
  const milestonesRoot = path.join(mcRoot, "milestones");
  const topologyRegistry = path.join(mcRoot, "topology.json");
  const id = `quick-${name}`.replace(/[^a-z0-9-]+/g, "-");
  const projectFolder = path.join(collabRoot, id);
  const mvpTasksPath = path.join(root, "mvp-tasks.json");
  fs.mkdirSync(mcRoot, { recursive: true });
  if (milestonesAsFile) fs.writeFileSync(milestonesRoot, "fixture blocks milestone creation\n");
  else fs.mkdirSync(milestonesRoot);
  fs.writeFileSync(topologyRegistry, `${JSON.stringify(topologyFixture(), null, 2)}\n`);
  fs.writeFileSync(mvpTasksPath, `${JSON.stringify([{
    id: "prove-contract",
    title: "證明 Quick contract",
    done_condition: "Quick receipt 與輸出符合 P0 契約。",
  }], null, 2)}\n`);

  const fixture = {
    root,
    collabRoot,
    mcRoot,
    milestonesRoot,
    topologyRegistry,
    id,
    projectFolder,
    mvpTasksPath,
    env: process.env,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
  if (commandTrap) configureCommandTrap(fixture);
  return fixture;
}

function runQuick(fixture, { projectFolder = fixture.projectFolder, env = {}, milestonesRoot = fixture.milestonesRoot, topologyRegistry = fixture.topologyRegistry } = {}) {
  return spawnSync("python3", quickArgs(fixture, projectFolder, { milestonesRoot, topologyRegistry }), {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...fixture.env, ...env },
  });
}

function runQuickAsync(fixture, { id = fixture.id, projectFolder = fixture.projectFolder } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", quickArgs(fixture, projectFolder, { id }), {
      cwd: repoRoot,
      env: fixture.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (status, signal) => resolve({ status, signal, stdout, stderr }));
  });
}

function quickArgs(fixture, projectFolder, { id = fixture.id, milestonesRoot = fixture.milestonesRoot, topologyRegistry = fixture.topologyRegistry } = {}) {
  return [
    initScript,
    "quick",
    "--id", id,
    "--name", "Quick Contract Fixture",
    "--desc", "驗證 Quick P0 contract。",
    "--project-code", "QCF",
    "--project-folder", projectFolder,
    "--why-open", "驗證 target-scoped Quick contract。",
    "--mvp-goal", "產出可驗證的 Quick receipt。",
    "--final-goal", "安全完成 Quick 開案。",
    "--mvp-tasks-file", fixture.mvpTasksPath,
    "--collab-root", fixture.collabRoot,
    "--milestones-root", milestonesRoot,
    "--topology-registry", topologyRegistry,
  ];
}

function expectReceipt(result, outcome) {
  const receipt = parseReceipt(result);
  assert.equal(receipt.outcome, outcome);
  assert.equal(result.status, outcome === "created" ? 0 : 2);
  assert.equal(receipt.target_status, outcome === "created" ? "ready" : "rejected");
  assert.equal(typeof receipt.duration_ms, "number");
  assert.ok(Array.isArray(receipt.maintenance_findings));
  if (outcome === "rejected") assert.match(receipt.reason_code || "", /^[a-z_]+$/);
  else assert.ok(!("reason_code" in receipt));
  return receipt;
}

function parseReceipt(result) {
  assert.ok(result.stdout.trim(), result.stderr || "Quick returned no stdout receipt");
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    assert.fail(`Quick stdout must be one JSON receipt: ${error.message}`);
  }
}

function createConflict(fixture, conflict) {
  if (conflict === "id") {
    const registry = JSON.parse(fs.readFileSync(fixture.topologyRegistry, "utf8"));
    registry.records.push({
      ...topologyFixture().records[0],
      id: fixture.id,
      path_label: "$COLLAB/already-owned",
      project_home_ref: "$COLLAB/already-owned",
    });
    fs.writeFileSync(fixture.topologyRegistry, `${JSON.stringify(registry, null, 2)}\n`);
  } else if (conflict === "folder") {
    fs.mkdirSync(fixture.projectFolder);
    fs.writeFileSync(path.join(fixture.projectFolder, "occupied.txt"), "occupied\n");
  } else if (conflict === "readme") {
    fs.mkdirSync(fixture.projectFolder);
    fs.writeFileSync(path.join(fixture.projectFolder, "README.md"), "existing\n");
  } else {
    fs.mkdirSync(path.join(fixture.milestonesRoot, fixture.id));
  }
}

function assertArtifacts(fixture) {
  assert.ok(fs.existsSync(path.join(fixture.projectFolder, "README.md")));
  assert.ok(fs.existsSync(path.join(fixture.milestonesRoot, fixture.id, "project.json")));
  assert.ok(fs.existsSync(path.join(fixture.milestonesRoot, fixture.id, "tasks.json")));
  const registry = JSON.parse(fs.readFileSync(fixture.topologyRegistry, "utf8"));
  assert.ok(registry.records.some((record) => record.id === fixture.id));
}

function configureCommandTrap(fixture) {
  const bin = path.join(fixture.root, "bin");
  fixture.commandLog = path.join(fixture.root, "external.log");
  fs.mkdirSync(bin);
  fs.writeFileSync(fixture.commandLog, "");
  for (const command of ["git", "gh", "zeabur", "curl", "open"]) {
    const executable = path.join(bin, command);
    fs.writeFileSync(executable, `#!/bin/sh\nprintf '%s\\n' '${command}' >> "$QUICK_COMMAND_LOG"\nexit 98\n`, { mode: 0o755 });
  }
  fixture.env = {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    QUICK_COMMAND_LOG: fixture.commandLog,
  };
}

function digest(root) {
  const entries = [];
  walk(root, root, entries);
  return entries.join("\n");
}

function walk(root, current, entries) {
  for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const absolute = path.join(current, entry.name);
    entries.push(`${entry.isDirectory() ? "d" : entry.isSymbolicLink() ? "l" : "f"}:${path.relative(root, absolute)}`);
    if (entry.isDirectory()) walk(root, absolute, entries);
    else if (entry.isFile()) entries.push(fs.readFileSync(absolute, "utf8"));
  }
}

function topologyFixture() {
  const today = new Date().toISOString().slice(0, 10);
  return {
    registry_id: "morrowise-project-topology.v1",
    maintenance_policy: { evidence_warn_after_days: 30 },
    records: [{
      id: "harness-mc",
      path_label: "$COLLAB/harness-mc",
      classification: "canonical_project",
      migration_state: "inventory_only",
      project_home_ref: "$COLLAB/harness-mc",
      topology_profile: "git-repository",
      document_ref: null,
      repo_ref: "$COLLAB/harness-mc",
      evidence: ["$COLLAB/harness-mc"],
      last_verified_at: today,
      notes: "Quick P0 isolated verifier fixture.",
    }],
  };
}
