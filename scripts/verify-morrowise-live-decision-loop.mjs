import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateLiveDecision } from "./lib/morrowise-live-decision.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mcRoot = path.resolve(__dirname, "..");

console.log("=== Running MorroWise Live Decision Loop Verification Suite (DDV1-P2-01) ===\n");

// --- Synthetic Fixtures ---
const mockActionPriority = {
  schema_version: "action-priority.v2",
  as_of: "2026-09-13",
  summary: {
    total_tasks: 93,
    eligible_count: 19,
    blocked_count: 11,
    suppressed_count: 63,
    top_focus_task: "mock-focus-task",
  },
  focus: {
    task_id: "mock-focus-task",
    order_label: "MW-TEST-01",
    title: "Mock Focus Task",
    priority_score: 8000,
    score: 8000,
    reasons: ["priority_high(+2000)", "weekly_core(+10000)"],
    done_condition: "Mock done condition",
  },
  next_action: {
    target: "mock-focus-task",
    label: "Execute MW-TEST-01: Mock Focus Task",
  },
  eligible_actions: [
    { id: "mock-focus-task", score: 8000 },
    { id: "mock-eligible-task-2", score: 5000 },
  ],
  blocked_actions: [],
  suppressed_actions: [],
};

const mockHeartbeatHealthy = {
  schema_version: "trusted-heartbeat.v1",
  as_of: "2026-09-13",
  overall_status: "healthy",
  freshness: "fresh",
  tasks: [
    { id: "task-1", status: "verified", attention_level: "normal" },
    { id: "task-2", status: "verified", attention_level: "normal" },
  ],
  next_action: null,
};

const mockHeartbeatVerified = {
  schema_version: "trusted-heartbeat.v1",
  as_of: "2026-09-13",
  overall_status: "verified",
  freshness: "fresh",
  tasks: [
    { id: "task-1", status: "verified", attention_level: "normal" },
    { id: "task-2", status: "verified", attention_level: "normal" },
  ],
  next_action: null,
};

const mockHeartbeatDegraded = {
  schema_version: "trusted-heartbeat.v1",
  as_of: "2026-09-13",
  overall_status: "degraded",
  freshness: "fresh",
  tasks: [
    { id: "task-1", status: "verified", attention_level: "normal" },
    {
      id: "system-pulse",
      status: "degraded",
      reason: "exit_code_1",
      attention_level: "needs_review",
      last_run: {
        exit_code: 1,
        log_ref: "runs/pulse.log",
      },
    },
  ],
  next_action: {
    type: "investigate",
    target: "system-pulse",
    label: "Task system-pulse failed with exit 1. Inspect log: runs/pulse.log",
  },
};

const mockHeartbeatBlocked = {
  schema_version: "trusted-heartbeat.v1",
  as_of: "2026-09-13",
  overall_status: "blocked",
  freshness: "stale",
  tasks: [
    { id: "dispatch", status: "blocked", reason: "missing_runner", attention_level: "blocked" },
  ],
  next_action: {
    type: "investigate",
    target: "scheduler",
    label: "Restart launchd schedule dispatch daemon",
  },
};

const mockTasks = [
  {
    id: "reality-tax-daily-review-task",
    status: "cancelled",
    title: "Reality Tax Daily Review",
    summary: "Replaced by morrowise-live-decision-loop-v1",
  },
  {
    id: "morrowise-live-decision-loop-v1",
    status: "in_progress",
    track: "implementation",
    title: "MorroWise 每日決策迴圈 v1",
    replaces_task_refs: ["reality-tax-daily-review-task"],
    done_condition: "All tests pass",
    task_lifecycle: {
      history: [
        { operation: "create", recorded_at: "2026-07-21" },
        { operation: "amend", recorded_at: "2026-09-13" },
      ],
    },
  },
  {
    id: "stale-in-progress-task",
    status: "in_progress",
    track: "concept",
    title: "Stale In Progress Task",
    task_lifecycle: {
      history: [
        { operation: "create", recorded_at: "2026-08-01" },
        { operation: "amend", recorded_at: "2026-08-10" },
      ],
    },
  },
];

// --- Case 1: Missing Action Priority ---
const resMissingPriority = evaluateLiveDecision({
  actionPriority: null,
  heartbeat: mockHeartbeatVerified,
  tasks: mockTasks,
  asOf: "2026-09-13",
});
assert.equal(resMissingPriority.overall_status, "blocked");
assert.ok(resMissingPriority.issues.includes("missing_or_invalid_action_priority_input"));
assert.equal(resMissingPriority.primary_focus, null);

// --- Case 2: Missing Heartbeat ---
const resMissingHeartbeat = evaluateLiveDecision({
  actionPriority: mockActionPriority,
  heartbeat: null,
  tasks: mockTasks,
  asOf: "2026-09-13",
});
assert.equal(resMissingHeartbeat.overall_status, "blocked");
assert.ok(resMissingHeartbeat.issues.includes("missing_or_invalid_trusted_heartbeat_input"));

// --- Case 3: Blocked Heartbeat ---
const resBlockedHeartbeat = evaluateLiveDecision({
  actionPriority: mockActionPriority,
  heartbeat: mockHeartbeatBlocked,
  tasks: mockTasks,
  asOf: "2026-09-13",
});
assert.equal(resBlockedHeartbeat.overall_status, "blocked");

// --- Case 4: Degraded Heartbeat (system-pulse fail) ---
const resDegradedHeartbeat = evaluateLiveDecision({
  actionPriority: mockActionPriority,
  heartbeat: mockHeartbeatDegraded,
  tasks: mockTasks,
  asOf: "2026-09-13",
});
assert.equal(resDegradedHeartbeat.overall_status, "degraded");
assert.equal(resDegradedHeartbeat.primary_focus.task_id, "mock-focus-task");
assert.ok(
  resDegradedHeartbeat.recommended_human_actions.some((a) => a.type === "heartbeat_degraded"),
  "Must include degraded heartbeat alert in recommended actions"
);

// --- Case 5: Verified Heartbeat & Active Task ---
const resVerified = evaluateLiveDecision({
  actionPriority: mockActionPriority,
  heartbeat: mockHeartbeatVerified,
  tasks: [mockTasks[0], mockTasks[1]], // exclude stale task for clean verify
  asOf: "2026-09-13",
});
assert.equal(resVerified.overall_status, "verified");
assert.equal(resVerified.primary_focus.task_id, "mock-focus-task");
assert.equal(resVerified.primary_focus.score, 8000);
assert.ok(resVerified.brief_message.includes("Mock Focus Task"));
assert.ok(resVerified.brief_message.includes("正常"));

// --- Case 5b: Healthy Heartbeat (All Green) ---
const resHealthy = evaluateLiveDecision({
  actionPriority: mockActionPriority,
  heartbeat: mockHeartbeatHealthy,
  tasks: [mockTasks[0], mockTasks[1]],
  asOf: "2026-09-13",
});
assert.equal(resHealthy.overall_status, "verified");
assert.equal(resHealthy.heartbeat_status.status, "healthy");
assert.equal(resHealthy.heartbeat_status.attention_required, false);
assert.ok(resHealthy.brief_message.includes("⚡ 系統心跳：正常"));

// --- Case 6: Reality Tax Replacement Lineage ---
assert.equal(resVerified.reality_tax.replacement_lineage.legacy_task_id, "reality-tax-daily-review-task");
assert.equal(resVerified.reality_tax.replacement_lineage.successor_task_id, "morrowise-live-decision-loop-v1");
assert.equal(resVerified.reality_tax.replacement_lineage.legacy_status, "cancelled");

// --- Case 7a: Reality Tax without gate records is not_evaluable, never a fake "cleared" ---
const resNoRecords = evaluateLiveDecision({
  actionPriority: mockActionPriority,
  heartbeat: mockHeartbeatHealthy,
  tasks: mockTasks,
  asOf: "2026-09-13",
});
assert.equal(resNoRecords.reality_tax.status, "not_evaluable");
assert.equal(resNoRecords.overall_status, "verified", "not_evaluable Reality Tax must not fake a degraded state");

// --- Case 7b: Reality Tax gate records drive attention items ---
const resWithRecords = evaluateLiveDecision({
  actionPriority: mockActionPriority,
  heartbeat: mockHeartbeatHealthy,
  tasks: mockTasks,
  realityTaxRecords: [
    { route: "mark_reality_gap", task_anchor: "morrowise/stale-in-progress-task", evidence_refs: [] },
    { route: "attach_output", task_anchor: null, evidence_refs: [] },
    { route: "create_task_anchor", task_anchor: "morrowise/morrowise-live-decision-loop-v1", evidence_refs: [] },
  ],
  asOf: "2026-09-13",
});
assert.equal(resWithRecords.reality_tax.status, "attention_needed");
assert.equal(resWithRecords.reality_tax.attention_items.length, 2);
assert.ok(resWithRecords.reality_tax.attention_items.some((i) => i.route === "mark_reality_gap"));
assert.ok(resWithRecords.reality_tax.attention_items.some((i) => i.route === "attach_output" && i.task_id === null));
assert.equal(resWithRecords.overall_status, "degraded");

// --- Case 8: Multi-Agent Determinism ---
for (let i = 0; i < 5; i++) {
  const repeated = evaluateLiveDecision({
    actionPriority: mockActionPriority,
    heartbeat: mockHeartbeatDegraded,
    tasks: mockTasks,
    asOf: "2026-09-13",
    generatedAt: "2026-09-13T10:00:00.000Z",
  });
  assert.deepEqual(
    repeated,
    evaluateLiveDecision({
      actionPriority: mockActionPriority,
      heartbeat: mockHeartbeatDegraded,
      tasks: mockTasks,
      asOf: "2026-09-13",
      generatedAt: "2026-09-13T10:00:00.000Z",
    }),
    "Evaluation must be strictly deterministic across repeated runs"
  );
}

// --- Case 9: Read-Only Contract ---
assert.equal(resVerified.read_only, true);
assert.ok(resVerified.write_boundary.forbidden.includes("modify task state"));
assert.ok(resVerified.write_boundary.forbidden.includes("modify tasks.json"));

console.log("✔ Suite 1: Synthetic Fixtures & Decision Contract Tests PASSED\n");

// --- Suite 2: Real Environment Canonical Evaluation (Temp Dir Isolated) ---
console.log("=== Checking Real Environment Live Decision Canonical Generation ===");

const liveActionPriorityPath = path.join(mcRoot, "public", "data", "action-priority.json");
const liveHeartbeatPath = path.join(mcRoot, "public", "data", "trusted-heartbeat.json");
const liveTasksPath = path.join(mcRoot, "milestones", "morrowise", "tasks.json");

assert.ok(fs.existsSync(liveActionPriorityPath), "public/data/action-priority.json must exist");
assert.ok(fs.existsSync(liveHeartbeatPath), "public/data/trusted-heartbeat.json must exist");
assert.ok(fs.existsSync(liveTasksPath), "milestones/morrowise/tasks.json must exist");

const tmpOutDir = fs.mkdtempSync(path.join(os.tmpdir(), "morrowise-live-decision-out."));
const testOutPath = path.join(tmpOutDir, "morrowise-live-decision.json");

try {
  const liveResult = evaluateLiveDecision({
    actionPriorityPath: liveActionPriorityPath,
    heartbeatPath: liveHeartbeatPath,
    tasksPath: liveTasksPath,
    outPath: testOutPath,
    write: true,
  });

  assert.equal(liveResult.schema_version, "morrowise-live-decision.v1");
  assert.ok(["verified", "degraded", "blocked"].includes(liveResult.overall_status));

  // Verify dynamic consistency with actual input files
  const hbData = JSON.parse(fs.readFileSync(liveHeartbeatPath, "utf8"));
  assert.equal(liveResult.heartbeat_status.status, hbData.overall_status);

  // If heartbeat is degraded/blocked, overall status must reflect it
  if (hbData.overall_status === "blocked") {
    assert.equal(liveResult.overall_status, "blocked");
  } else if (hbData.overall_status === "degraded") {
    assert.equal(liveResult.overall_status, "degraded");
  }

  assert.ok(liveResult.primary_focus, "Must identify primary focus in real environment");
  assert.ok(liveResult.recommended_human_actions.length >= 1, "Must include at least primary focus action");

  // Verify written output file in temp directory
  assert.ok(fs.existsSync(testOutPath), "Temp morrowise-live-decision.json must be written");
  const writtenJson = JSON.parse(fs.readFileSync(testOutPath, "utf8"));
  assert.equal(writtenJson.schema_version, "morrowise-live-decision.v1");
  assert.equal(writtenJson.overall_status, liveResult.overall_status);
  assert.equal(writtenJson.primary_focus?.task_id, liveResult.primary_focus?.task_id);

  console.log(`✔ Real Environment Evaluation (Temp-Isolated):`);
  console.log(`  - Overall Status:   ${liveResult.overall_status}`);
  console.log(`  - Primary Focus:    ${liveResult.primary_focus?.task_id} (${liveResult.primary_focus?.order_label || liveResult.primary_focus?.task_id})`);
  console.log(`  - Recommended:      ${liveResult.recommended_human_actions.length} action(s)`);
  console.log(`  - Heartbeat:        ${liveResult.heartbeat_status.status} (${liveResult.heartbeat_status.degraded_tasks.length} degraded)`);
  console.log(`  - Reality Tax:      ${liveResult.reality_tax.status} (${liveResult.reality_tax.attention_items.length} attention items)`);
  console.log(`\nBrief Notification Message:\n---\n${liveResult.brief_message}\n---`);
} finally {
  fs.rmSync(tmpOutDir, { recursive: true, force: true });
}

console.log("\nALL MORROWISE LIVE DECISION VERIFICATION CHECKS (DDV1-P2-01) PASSED!");
