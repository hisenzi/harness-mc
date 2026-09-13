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

// Case 2: Suppression rules
const suppressedIds = syntheticResult.suppressed_actions.map((t) => t.id);
assert.ok(suppressedIds.includes("task-completed"), "Completed task must be suppressed");
assert.ok(suppressedIds.includes("task-deferred"), "Deferred task must be suppressed");
assert.ok(suppressedIds.includes("task-cancelled-legacy"), "Cancelled task must be suppressed");

const cancelledTask = syntheticResult.suppressed_actions.find((t) => t.id === "task-cancelled-legacy");
assert.equal(cancelledTask.replacement_task_id, "task-daily-loop");

// Case 3: Blocked rules
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

// Case 4: Eligible ranking & Top Focus
const eligibleIds = syntheticResult.eligible_actions.map((t) => t.id);
assert.ok(eligibleIds.includes("task-weekly-core-active"));
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

// Case 7: Reality Tax Supersession Lineage
assert.ok(syntheticResult.supersessions.length > 0);
const rtSupersession = syntheticResult.supersessions.find(
  (s) => s.legacy_task_id === "reality-tax-daily-review-task"
);
assert.ok(rtSupersession, "Must track reality-tax-daily-review-task supersession");
assert.equal(rtSupersession.successor_task_id, "morrowise-live-decision-loop-v1");

console.log("✔ Suite 1: Synthetic Fixtures & Algorithmic Contract Tests PASSED");

// -------------------------------------------------------------
// Suite 2: Real Environment Canonical Task Evaluation
// -------------------------------------------------------------
console.log("\n=== Checking Real Environment Canonical Evaluation ===");

const liveOutPath = path.join(mcRoot, "public", "data", "action-priority.json");
const liveResult = generateActionPriority({
  tasksPath: realTasksPath,
  heartbeatPath: realHeartbeatPath,
  asOf: asOfDate,
  outPath: liveOutPath,
  write: true,
});

assert.equal(liveResult.schema_version, "action-priority.v2");
assert.ok(liveResult.summary.total_tasks > 50, "Must load full canonical task list");
assert.ok(liveResult.summary.eligible_count > 0, "Must identify eligible actions");
assert.ok(liveResult.summary.blocked_count > 0, "Must identify blocked actions");
assert.ok(liveResult.summary.suppressed_count > 0, "Must identify suppressed actions");

// Verify that completed action-priority-read-model-v2 is safely suppressed
const suppressedTask = liveResult.suppressed_actions.find(
  (t) => t.id === "action-priority-read-model-v2"
);
assert.ok(suppressedTask, "action-priority-read-model-v2 must be suppressed after completion");
assert.equal(suppressedTask.status, "completed");

// Verify that downstream task morrowise-live-decision-loop-v1 is unblocked and eligible
const liveDecisionTask = liveResult.eligible_actions.find(
  (t) => t.id === "morrowise-live-decision-loop-v1"
);
assert.ok(liveDecisionTask, "morrowise-live-decision-loop-v1 must become eligible once dependencies complete");

// Verify valid focus & next action
assert.ok(liveResult.summary.top_focus_task, "Must pick a top focus task");
assert.ok(liveResult.focus && liveResult.focus.task_id, "Focus must have a valid task_id");
assert.ok(liveResult.next_action && liveResult.next_action.label, "Next action must have a label");

// Verify file written to disk
assert.ok(fs.existsSync(liveOutPath), "public/data/action-priority.json must be written");
const writtenData = JSON.parse(fs.readFileSync(liveOutPath, "utf8"));
assert.equal(writtenData.schema_version, "action-priority.v2");
assert.equal(writtenData.summary.top_focus_task, liveResult.summary.top_focus_task);

console.log(`✔ Real Canonical Evaluation:`);
console.log(`  - Total tasks:       ${liveResult.summary.total_tasks}`);
console.log(`  - Eligible actions:  ${liveResult.summary.eligible_count}`);
console.log(`  - Blocked actions:   ${liveResult.summary.blocked_count}`);
console.log(`  - Suppressed:        ${liveResult.summary.suppressed_count}`);
console.log(`  - Top focus task:    ${liveResult.summary.top_focus_task} (${liveResult.focus.order_label})`);
console.log(`  - Next action label: ${liveResult.next_action.label}`);

console.log("\nALL ACTION PRIORITY VERIFICATION CHECKS (APV2-P2-01) PASSED!");
