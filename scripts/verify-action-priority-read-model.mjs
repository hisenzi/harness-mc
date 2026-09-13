#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateActionPriority, generateActionPriority } from "./lib/action-priority.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mcRoot = path.resolve(__dirname, "..");
const realTasksPath = path.join(mcRoot, "milestones", "morrowise", "tasks.json");
const realHeartbeatPath = path.join(mcRoot, "public", "data", "trusted-heartbeat.json");

console.log("=== Running Action Priority Verification Suite (APV2-P2-01) ===");

// -------------------------------------------------------------
// Suite 1: Synthetic Fixtures & Algorithmic Contract Tests
// -------------------------------------------------------------
const fixtureTasks = [
  {
    id: "task-completed",
    title: "Completed Task",
    status: "completed",
    priority: "critical",
    dependencies: [],
  },
  {
    id: "task-done",
    title: "Done Task",
    status: "done",
    priority: "high",
    dependencies: [],
  },
  {
    id: "task-fixed",
    title: "Fixed Task",
    status: "fixed",
    priority: "medium",
    dependencies: [],
  },
  {
    id: "task-deferred",
    title: "Deferred Task",
    status: "deferred",
    priority: "high",
    dependencies: [],
  },
  {
    id: "task-cancelled-legacy",
    title: "Reality Tax Legacy Task",
    status: "cancelled",
    replacement_task_id: "task-daily-loop",
    dependencies: [],
  },
  {
    id: "task-daily-loop",
    title: "Daily Loop Successor",
    status: "in_progress",
    priority: "high",
    replaces_task_refs: ["task-cancelled-legacy"],
    dependencies: ["task-done"],
  },
  {
    id: "task-blocked-by-dep",
    title: "Task Blocked By Dep",
    status: "todo",
    priority: "critical",
    dependencies: ["task-uncompleted-parent"],
  },
  {
    id: "task-uncompleted-parent",
    title: "Uncompleted Parent",
    status: "in_progress",
    priority: "medium",
    dependencies: [],
  },
  {
    id: "task-weekly-core-active",
    title: "Current Weekly Core",
    status: "in_progress",
    priority: "high",
    weekly_core: true,
    review_date: "2026-09-20",
    order_label: "MW-CORE-01",
    dependencies: ["task-completed"],
  },
  {
    id: "task-weekly-core-overdue",
    title: "Overdue Weekly Core",
    status: "in_progress",
    priority: "critical",
    weekly_core: true,
    review_date: "2026-08-01",
    dependencies: [],
  },
  {
    id: "task-independent-todo",
    title: "Independent Normal Task",
    status: "todo",
    priority: "low",
    dependencies: ["task-completed"],
  },
];

const asOfDate = "2026-09-13";
const syntheticResult = evaluateActionPriority({
  tasks: fixtureTasks,
  asOf: asOfDate,
  generatedAt: "2026-09-13T10:00:00.000Z",
});

// Case 1: Schema & Read-Only Write Boundary
assert.equal(syntheticResult.schema_version, "action-priority.v2");
assert.equal(syntheticResult.read_only, true);
assert.ok(syntheticResult.write_boundary.forbidden.includes("modify task state"));
assert.ok(syntheticResult.write_boundary.forbidden.includes("modify tasks.json"));

// Case 2: Suppression rules (completed, done, fixed, deferred, cancelled)
const suppressedIds = syntheticResult.suppressed_actions.map((t) => t.id);
assert.ok(suppressedIds.includes("task-completed"), "Completed task must be suppressed");
assert.ok(suppressedIds.includes("task-done"), "Done task must be suppressed");
assert.ok(suppressedIds.includes("task-fixed"), "Fixed task must be suppressed");
assert.ok(suppressedIds.includes("task-deferred"), "Deferred task must be suppressed");
assert.ok(suppressedIds.includes("task-cancelled-legacy"), "Cancelled task must be suppressed");

const cancelledTask = syntheticResult.suppressed_actions.find((t) => t.id === "task-cancelled-legacy");
assert.equal(cancelledTask.replacement_task_id, "task-daily-loop");

// Case 3: Blocked rules & Done/Fixed dependency satisfaction
const blockedMap = new Map(syntheticResult.blocked_actions.map((t) => [t.id, t]));
assert.ok(blockedMap.has("task-blocked-by-dep"), "Task with uncompleted dep must be blocked");
assert.ok(
  blockedMap.get("task-blocked-by-dep").blocked_reasons[0].includes("uncompleted_dependency"),
  "Blocker reason must name uncompleted dependency"
);

assert.ok(blockedMap.has("task-weekly-core-overdue"), "Overdue weekly core must be blocked");
assert.ok(
  blockedMap.get("task-weekly-core-overdue").blocked_reasons[0].includes("weekly_core_review_overdue"),
  "Blocker reason must name overdue review_date"
);

// Crucial: task-daily-loop depends on task-done. Since task-done is "done", task-daily-loop must NOT be blocked!
assert.ok(!blockedMap.has("task-daily-loop"), "Task depending on done task must NOT be blocked");

// Case 4: Eligible ranking & Top Focus
const eligibleIds = syntheticResult.eligible_actions.map((t) => t.id);
assert.ok(eligibleIds.includes("task-weekly-core-active"));
assert.ok(eligibleIds.includes("task-daily-loop"), "task-daily-loop must be eligible");
assert.ok(eligibleIds.includes("task-uncompleted-parent"));
assert.ok(eligibleIds.includes("task-independent-todo"));

// task-weekly-core-active should be #1 because of weekly_core (+10000) + in_progress (+5000) + high (+2000) = 17000
assert.equal(syntheticResult.summary.top_focus_task, "task-weekly-core-active");
assert.equal(syntheticResult.focus.task_id, "task-weekly-core-active");
assert.equal(syntheticResult.next_action.target, "task-weekly-core-active");

// Case 5: Dependent unblocking score
// task-uncompleted-parent unblocks task-blocked-by-dep (+200) + in_progress (+5000) + medium (+1000) = 6200
const parentAction = syntheticResult.eligible_actions.find((t) => t.id === "task-uncompleted-parent");
assert.ok(parentAction.score >= 6200);

// Case 6: Determinism across physical shuffling
for (let i = 0; i < 5; i++) {
  const shuffled = [...fixtureTasks].sort(() => Math.random() - 0.5);
  const shuffledResult = evaluateActionPriority({
    tasks: shuffled,
    asOf: asOfDate,
    generatedAt: "2026-09-13T10:00:00.000Z",
  });
  assert.equal(shuffledResult.summary.top_focus_task, "task-weekly-core-active");
  assert.deepEqual(
    shuffledResult.eligible_actions.map((t) => t.id),
    syntheticResult.eligible_actions.map((t) => t.id),
    "Physical ordering in tasks array must NEVER affect priority ranking"
  );
}

// Case 7: Dynamic Supersession Lineage (replaces_task_refs & replacement_task_id)
assert.ok(syntheticResult.supersessions.length > 0);
const fixtureSupersession = syntheticResult.supersessions.find(
  (s) => s.legacy_task_id === "task-cancelled-legacy"
);
assert.ok(fixtureSupersession, "Must dynamically track task-cancelled-legacy supersession");
assert.equal(fixtureSupersession.successor_task_id, "task-daily-loop");

console.log("✔ Suite 1: Synthetic Fixtures & Algorithmic Contract Tests PASSED");

// -------------------------------------------------------------
// Suite 2: Real Environment Canonical Task Evaluation (Temp Dir Isolation)
// -------------------------------------------------------------
console.log("\n=== Checking Real Environment Canonical Evaluation ===");

const tmpOutDir = fs.mkdtempSync(path.join(os.tmpdir(), "action-priority-out."));
const testOutPath = path.join(tmpOutDir, "action-priority.json");

try {
  const liveResult = generateActionPriority({
    tasksPath: realTasksPath,
    heartbeatPath: realHeartbeatPath,
    outPath: testOutPath,
    write: true,
  });

  assert.equal(liveResult.schema_version, "action-priority.v2");
  assert.ok(liveResult.summary.total_tasks > 50, "Must load full canonical task list");

  // Invariant: sum of categories equals total tasks
  const sumTasks =
    liveResult.summary.eligible_count +
    liveResult.summary.blocked_count +
    liveResult.summary.suppressed_count;
  assert.equal(sumTasks, liveResult.summary.total_tasks, "Summary counts must sum up to total tasks");

  // Verify that all done tasks in canonical tasks.json are suppressed
  for (const doneId of [
    "v0-boundary-lineage-map",
    "mc-morrowise-v0-card",
    "notification-first-delivery",
    "launchd-tcc-downloads-access",
  ]) {
    const task = liveResult.suppressed_actions.find((t) => t.id === doneId);
    assert.ok(task, `${doneId} (status: done) must be suppressed in read model`);
    assert.equal(task.status, "done");
  }

  // Verify that morrowise-product-promotion-gate is NOT blocked by notification-first-delivery
  const promoGateBlocked = liveResult.blocked_actions.find((t) => t.id === "morrowise-product-promotion-gate");
  assert.ok(
    !promoGateBlocked,
    "morrowise-product-promotion-gate must NOT be blocked (notification-first-delivery dependency is done)"
  );
  const promoGateEligible = liveResult.eligible_actions.find((t) => t.id === "morrowise-product-promotion-gate");
  assert.ok(promoGateEligible, "morrowise-product-promotion-gate must be eligible");

  // Verify that completed action-priority-read-model-v2 is safely suppressed
  const suppressedTask = liveResult.suppressed_actions.find(
    (t) => t.id === "action-priority-read-model-v2"
  );
  assert.ok(suppressedTask, "action-priority-read-model-v2 must be suppressed after completion");
  assert.equal(suppressedTask.status, "completed");

  // Verify dynamic Reality Tax supersession lineage from canonical tasks.json
  const rtSupersession = liveResult.supersessions.find(
    (s) => s.legacy_task_id === "reality-tax-daily-review-task"
  );
  assert.ok(rtSupersession, "Must dynamically find reality-tax-daily-review-task supersession");
  assert.equal(rtSupersession.successor_task_id, "morrowise-live-decision-loop-v1");

  // Verify valid focus & next action
  assert.ok(liveResult.summary.top_focus_task, "Must pick a top focus task");
  assert.ok(liveResult.focus && liveResult.focus.task_id, "Focus must have a valid task_id");
  assert.ok(liveResult.next_action && liveResult.next_action.label, "Next action must have a label");

  // Verify file written safely to temp destination
  assert.ok(fs.existsSync(testOutPath), "Temp action-priority.json must be written");
  const writtenData = JSON.parse(fs.readFileSync(testOutPath, "utf8"));
  assert.equal(writtenData.schema_version, "action-priority.v2");
  assert.equal(writtenData.summary.top_focus_task, liveResult.summary.top_focus_task);

  console.log(`✔ Real Canonical Evaluation (Temp-Isolated):`);
  console.log(`  - Total tasks:       ${liveResult.summary.total_tasks}`);
  console.log(`  - Eligible actions:  ${liveResult.summary.eligible_count}`);
  console.log(`  - Blocked actions:   ${liveResult.summary.blocked_count}`);
  console.log(`  - Suppressed:        ${liveResult.summary.suppressed_count}`);
  console.log(`  - Top focus task:    ${liveResult.summary.top_focus_task} (${liveResult.focus.order_label || liveResult.focus.task_id})`);
  console.log(`  - Next action label: ${liveResult.next_action.label}`);
} finally {
  fs.rmSync(tmpOutDir, { recursive: true, force: true });
}

console.log("\nALL ACTION PRIORITY VERIFICATION CHECKS (APV2-P2-01) PASSED!");
