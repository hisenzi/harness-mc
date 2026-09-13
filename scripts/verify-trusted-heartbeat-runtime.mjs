#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateHeartbeat, generateTrustedHeartbeat } from "./lib/trusted-heartbeat.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mcRoot = path.resolve(__dirname, "..");
const collabRoot = path.resolve(mcRoot, "..");
const realSchedulerRoot = path.join(collabRoot, "notyet-harness", "schedule");
const realLaunchAgentsDir = path.join(os.homedir(), "Library", "LaunchAgents");

console.log("=== Running Trusted Heartbeat Verification Suite ===");

// -------------------------------------------------------------
// Suite 1: Isolated Fixture Tests (Edge Cases & Boundaries)
// -------------------------------------------------------------
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "trusted-heartbeat-test."));
const schedulerRoot = path.join(tmpRoot, "schedule");
const launchAgentsDir = path.join(tmpRoot, "LaunchAgents");
const outPath = path.join(tmpRoot, "trusted-heartbeat.json");

try {
  fs.mkdirSync(path.join(schedulerRoot, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(schedulerRoot, "runs"), { recursive: true });
  fs.mkdirSync(path.join(schedulerRoot, "runners"), { recursive: true });
  fs.mkdirSync(launchAgentsDir, { recursive: true });

  fs.writeFileSync(path.join(schedulerRoot, "dispatch.sh"), "#!/usr/bin/env bash\n");
  fs.writeFileSync(path.join(schedulerRoot, "install.sh"), "#!/usr/bin/env bash\n");
  fs.writeFileSync(path.join(schedulerRoot, "runners", "shell.sh"), "#!/usr/bin/env bash\n");

  // Poison pill: .env file with secret tokens that must never be read
  fs.writeFileSync(
    path.join(schedulerRoot, ".env"),
    "SECRET_API_TOKEN=super_confidential_token_998877\nDATABASE_PASSWORD=ultra_secret_pw\n"
  );

  // Task specs
  fs.writeFileSync(
    path.join(schedulerRoot, "tasks", "task-healthy.yaml"),
    [
      "id: task-healthy",
      'schedule: "10 22 * * *"',
      "runner: shell",
      "timeout: 120",
      "delivery: configured adapter",
    ].join("\n") + "\n"
  );

  fs.writeFileSync(
    path.join(schedulerRoot, "tasks", "task-failed.yaml"),
    [
      "id: task-failed",
      'schedule: "30 8 * * *"',
      "runner: shell",
      "timeout: 120",
      "delivery: none",
    ].join("\n") + "\n"
  );

  fs.writeFileSync(
    path.join(schedulerRoot, "tasks", "task-exit126.yaml"),
    [
      "id: task-exit126",
      'schedule: "45 8 * * *"',
      "runner: shell",
      "timeout: 300",
      "delivery: none",
    ].join("\n") + "\n"
  );

  fs.writeFileSync(
    path.join(schedulerRoot, "tasks", "task-unloaded.yaml"),
    [
      "id: task-unloaded",
      'schedule: "0 12 * * *"',
      "runner: shell",
      "timeout: 60",
      "delivery: none",
    ].join("\n") + "\n"
  );

  fs.writeFileSync(
    path.join(schedulerRoot, "tasks", "task-missing-runner.yaml"),
    [
      "id: task-missing-runner",
      'schedule: "0 15 * * *"',
      "runner: non-existent-runner",
      "timeout: 60",
      "delivery: none",
    ].join("\n") + "\n"
  );

  fs.writeFileSync(
    path.join(schedulerRoot, "tasks", "task-timeout.yaml"),
    [
      "id: task-timeout",
      'schedule: "0 18 * * *"',
      "runner: shell",
      "timeout: 60",
      "delivery: none",
    ].join("\n") + "\n"
  );

  fs.writeFileSync(
    path.join(schedulerRoot, "tasks", "task-stale.yaml"),
    [
      "id: task-stale",
      'schedule: "0 9 * * *"',
      "runner: shell",
      "timeout: 120",
      "delivery: none",
    ].join("\n") + "\n"
  );

  // Plists installation
  for (const id of ["task-healthy", "task-failed", "task-exit126", "task-missing-runner", "task-timeout", "task-stale"]) {
    fs.writeFileSync(path.join(launchAgentsDir, `com.hisenzi.schedule.${id}.plist`), "<plist></plist>\n");
  }
  // note: task-unloaded has NO plist

  const testNowMs = new Date("2026-09-13T10:00:00Z").getTime();

  // Run logs
  // 1. task-healthy: success today at 22:12 UTC yesterday
  fs.writeFileSync(
    path.join(schedulerRoot, "runs", "task-healthy-20260912T221200Z.log"),
    JSON.stringify({
      schema_version: "schedule-run.v0",
      run_id: "task-healthy-20260912T221200Z",
      task_id: "task-healthy",
      runner: "shell",
      status: "success",
      exit_code: 0,
      started_at: "2026-09-12T22:12:00Z",
      finished_at: "2026-09-12T22:12:10Z",
      duration_sec: 10,
      timeout_sec: 120,
      timeout_enforced: false,
    }) + "\n"
  );

  // 2. task-failed: failed today at 08:31 UTC with exit 1
  fs.writeFileSync(
    path.join(schedulerRoot, "runs", "task-failed-20260913T083100Z.log"),
    JSON.stringify({
      schema_version: "schedule-run.v0",
      run_id: "task-failed-20260913T083100Z",
      task_id: "task-failed",
      runner: "shell",
      status: "failed",
      exit_code: 1,
      started_at: "2026-09-13T08:31:00Z",
      finished_at: "2026-09-13T08:31:05Z",
      duration_sec: 5,
      timeout_sec: 120,
      timeout_enforced: false,
    }) + "\n"
  );

  // 3. task-exit126: exit 126
  fs.writeFileSync(
    path.join(schedulerRoot, "runs", "task-exit126-20260913T084500Z.log"),
    JSON.stringify({
      schema_version: "schedule-run.v0",
      run_id: "task-exit126-20260913T084500Z",
      task_id: "task-exit126",
      runner: "shell",
      status: "failed",
      exit_code: 126,
      started_at: "2026-09-13T08:45:00Z",
      finished_at: "2026-09-13T08:45:01Z",
      duration_sec: 1,
      timeout_sec: 300,
      timeout_enforced: false,
    }) + "\n"
  );

  // 4. task-timeout: timeout enforced
  fs.writeFileSync(
    path.join(schedulerRoot, "runs", "task-timeout-20260912T180000Z.log"),
    JSON.stringify({
      schema_version: "schedule-run.v0",
      run_id: "task-timeout-20260912T180000Z",
      task_id: "task-timeout",
      runner: "shell",
      status: "timeout",
      exit_code: 124,
      started_at: "2026-09-12T18:00:00Z",
      finished_at: "2026-09-12T18:01:05Z",
      duration_sec: 65,
      timeout_sec: 60,
      timeout_enforced: true,
    }) + "\n"
  );

  // 5. task-stale: last success was 5 days ago
  fs.writeFileSync(
    path.join(schedulerRoot, "runs", "task-stale-20260908T090000Z.log"),
    JSON.stringify({
      schema_version: "schedule-run.v0",
      run_id: "task-stale-20260908T090000Z",
      task_id: "task-stale",
      runner: "shell",
      status: "success",
      exit_code: 0,
      started_at: "2026-09-08T09:00:00Z",
      finished_at: "2026-09-08T09:00:10Z",
      duration_sec: 10,
      timeout_sec: 120,
      timeout_enforced: false,
    }) + "\n"
  );

  // Test 1: Evaluation of all negative and positive conditions
  const result = evaluateHeartbeat({
    schedulerRoot,
    launchAgentsDir,
    now: "2026-09-13T10:00:00Z",
    outPath,
    write: true,
  });

  // Check Schema & Write Boundary
  assert.equal(result.schema_version, "trusted-heartbeat.v1");
  assert.equal(result.read_only, true);
  assert.ok(result.write_boundary.forbidden.includes("read schedule/.env"));
  assert.ok(result.write_boundary.forbidden.includes("load launchd jobs"));
  assert.ok(result.write_boundary.forbidden.includes("modify task states"));

  // Check Secret Poison Pill: no leaks of .env secrets anywhere in stringified output
  const jsonStr = JSON.stringify(result);
  assert.ok(!jsonStr.includes("super_confidential_token"), "Must never leak secrets from .env");
  assert.ok(!jsonStr.includes("ultra_secret_pw"), "Must never leak password from .env");

  // Check Tasks Status
  const healthyTask = result.tasks.find((t) => t.id === "task-healthy");
  assert.ok(healthyTask);
  assert.equal(healthyTask.declared, true);
  assert.equal(healthyTask.loaded, true);
  assert.equal(healthyTask.runner_present, true);
  assert.equal(healthyTask.freshness, "live");
  assert.equal(healthyTask.status, "verified");
  assert.equal(healthyTask.attention_level, "normal");

  const failedTask = result.tasks.find((t) => t.id === "task-failed");
  assert.ok(failedTask);
  assert.equal(failedTask.status, "degraded");
  assert.equal(failedTask.reason, "last_run_failed");
  assert.equal(failedTask.attention_level, "needs_review");

  const exit126Task = result.tasks.find((t) => t.id === "task-exit126");
  assert.ok(exit126Task);
  assert.equal(exit126Task.status, "blocked");
  assert.equal(exit126Task.reason, "exit_126_permission_denied");
  assert.equal(exit126Task.attention_level, "blocked");

  const unloadedTask = result.tasks.find((t) => t.id === "task-unloaded");
  assert.ok(unloadedTask);
  assert.equal(unloadedTask.loaded, false);
  assert.equal(unloadedTask.status, "blocked");
  assert.equal(unloadedTask.reason, "unloaded_plist");
  assert.equal(unloadedTask.attention_level, "blocked");

  const missingRunnerTask = result.tasks.find((t) => t.id === "task-missing-runner");
  assert.ok(missingRunnerTask);
  assert.equal(missingRunnerTask.runner_present, false);
  assert.equal(missingRunnerTask.status, "blocked");
  assert.equal(missingRunnerTask.reason, "missing_runner");
  assert.equal(missingRunnerTask.attention_level, "blocked");

  const timeoutTask = result.tasks.find((t) => t.id === "task-timeout");
  assert.ok(timeoutTask);
  assert.equal(timeoutTask.status, "degraded");
  assert.equal(timeoutTask.reason, "timeout_exceeded");
  assert.equal(timeoutTask.attention_level, "needs_review");

  const staleTask = result.tasks.find((t) => t.id === "task-stale");
  assert.ok(staleTask);
  assert.equal(staleTask.freshness, "stale");
  assert.equal(staleTask.status, "degraded");
  assert.equal(staleTask.reason, "stale_run");

  // Overall status must be blocked when any task is blocked
  assert.equal(result.overall_status, "blocked");
  // Next action must prioritize exit 126 or missing runner or unloaded plist
  assert.ok(result.next_action.type === "repair" || result.next_action.type === "task" || result.next_action.type === "command");

  // Test 2: Fixture-Only barrier (anti-fake green)
  // When a fixture has all green/healthy runs, but fixtureOnly is set:
  const fixtureResult = evaluateHeartbeat({
    schedulerRoot,
    launchAgentsDir,
    now: "2026-09-13T10:00:00Z",
    fixtureOnly: true,
  });
  assert.equal(fixtureResult.evaluation_mode, "fixture");
  const fixtureHealthy = fixtureResult.tasks.find((t) => t.id === "task-healthy");
  // In fixture mode, even a healthy task cannot be labeled "verified"
  assert.equal(fixtureHealthy.status, "fixture_only");
  assert.equal(fixtureHealthy.reason, "fixture_only_synthetic_evidence");

  // Test 3: Determinism check
  const rep1 = evaluateHeartbeat({
    schedulerRoot,
    launchAgentsDir,
    now: "2026-09-13T10:00:00Z",
    generatedAt: "2026-09-13T10:00:00.000Z",
  });
  const rep2 = evaluateHeartbeat({
    schedulerRoot,
    launchAgentsDir,
    now: "2026-09-13T10:00:00Z",
    generatedAt: "2026-09-13T10:00:00.000Z",
  });
  assert.deepEqual(rep1, rep2, "Heartbeat evaluation must be deterministic");

  console.log("✔ Suite 1: Synthetic negative and positive edge cases PASSED");
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

// -------------------------------------------------------------
// Suite 2: Real Environment Safe Probe
// -------------------------------------------------------------
console.log("\n=== Checking Real Environment Safe Probe ===");

const realResult = evaluateHeartbeat({
  schedulerRoot: realSchedulerRoot,
  launchAgentsDir: realLaunchAgentsDir,
  now: new Date().toISOString(),
});

assert.equal(realResult.schema_version, "trusted-heartbeat.v1");
assert.equal(realResult.evaluation_mode, "live");
assert.equal(realResult.summary.tasks_total, 3, "Real environment must have exactly 3 tasks declared");

// Verify individual real tasks
const commitAttention = realResult.tasks.find((t) => t.id === "commit-attention-sweep");
assert.ok(commitAttention, "commit-attention-sweep must exist in real environment");
assert.equal(commitAttention.declared, true);
assert.equal(commitAttention.runner_present, true);
assert.equal(commitAttention.loaded, true, "LaunchAgent plist for commit-attention-sweep must be installed");
assert.equal(commitAttention.last_run?.status, "success", "commit-attention-sweep had natural run success");
assert.equal(commitAttention.last_run?.exit_code, 0);
assert.equal(commitAttention.freshness, "live");
assert.equal(commitAttention.status, "verified");

const mcSentinel = realResult.tasks.find((t) => t.id === "mc-sentinel");
assert.ok(mcSentinel, "mc-sentinel must exist in real environment");
assert.equal(mcSentinel.declared, true);
assert.equal(mcSentinel.runner_present, true);
assert.equal(mcSentinel.loaded, true, "LaunchAgent plist for mc-sentinel must be installed");
assert.equal(mcSentinel.last_run?.status, "success", "mc-sentinel had natural run success");
assert.equal(mcSentinel.last_run?.exit_code, 0);
assert.equal(mcSentinel.freshness, "live");
assert.equal(mcSentinel.status, "verified");

const systemPulse = realResult.tasks.find((t) => t.id === "system-pulse");
assert.ok(systemPulse, "system-pulse must exist in real environment");
assert.equal(systemPulse.declared, true);
assert.equal(systemPulse.runner_present, true);
assert.equal(systemPulse.loaded, true, "LaunchAgent plist for system-pulse must be installed");
// system-pulse ran naturally today at 08:45:05 UTC+0 and exited 1 (69/80 passed, pulse degraded)
assert.equal(systemPulse.last_run?.exit_code, 1);
assert.equal(systemPulse.status, "degraded", "system-pulse must be degraded due to exit 1");
assert.equal(systemPulse.reason, "last_run_failed");

// Overall status check:
// Real system has 2 verified successes + 1 degraded run -> overall_status must be degraded!
// IT MUST NOT BE FAKE GREEN!
assert.equal(realResult.overall_status, "degraded");
assert.equal(realResult.summary.verified_count, 2);
assert.equal(realResult.summary.degraded_count, 1);
assert.equal(realResult.summary.blocked_count, 0);
assert.equal(realResult.next_action.type, "investigate");
assert.equal(realResult.next_action.target, "system-pulse");

console.log(`✔ Real probe evaluation: overall_status="${realResult.overall_status}"`);
console.log(`  - commit-attention-sweep: ${commitAttention.status} (${commitAttention.freshness})`);
console.log(`  - mc-sentinel:            ${mcSentinel.status} (${mcSentinel.freshness})`);
console.log(`  - system-pulse:           ${systemPulse.status} (${systemPulse.reason})`);
console.log(`  - next_action:            ${realResult.next_action.target} — ${realResult.next_action.label}`);

// -------------------------------------------------------------
// Suite 3: Generate Real Read Model File Verification
// -------------------------------------------------------------
console.log("\n=== Generating Real Read Model File ===");
const liveOutPath = path.join(mcRoot, "public", "data", "trusted-heartbeat.json");
const generated = generateTrustedHeartbeat({
  schedulerRoot: realSchedulerRoot,
  launchAgentsDir: realLaunchAgentsDir,
  outPath: liveOutPath,
  write: true,
});

assert.ok(fs.existsSync(liveOutPath), "public/data/trusted-heartbeat.json must be generated");
const diskData = JSON.parse(fs.readFileSync(liveOutPath, "utf8"));
assert.equal(diskData.schema_version, "trusted-heartbeat.v1");
assert.equal(diskData.overall_status, "degraded");
assert.equal(diskData.tasks.length, 3);

console.log("✔ Suite 2 & 3: Real environment probe and generation PASSED");
console.log("\nALL TRUSTED HEARTBEAT VERIFICATION CHECKS PASSED!");
