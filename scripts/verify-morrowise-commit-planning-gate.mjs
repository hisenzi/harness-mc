import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const registryPath = path.join(root, "system-workflow", "registries", "morrowise-commit-planning-gate.json");
const specPath = path.join(root, "system-workflow", "docs", "specs", "morrowise-commit-planning-gate.md");
const tasksPath = path.join(root, "milestones", "morrowise", "tasks.json");

const registry = readJson(registryPath);
const spec = fs.readFileSync(specPath, "utf8");
const tasks = readJson(tasksPath).tasks;
const taskIds = new Set(tasks.map((task) => task.id));

assert.equal(registry.registry_id, "morrowise-commit-planning-gate.v0");
assert.equal(registry.task_id, "runtime-scheduler-v0");
assert.ok(taskIds.has(registry.task_id), "owner task must exist");
assert.ok(registry.input.includes("$COLLAB/harness-mc/public/data/commit-attention.json"), "commit-attention input required");
assert.ok(registry.input.includes("$COLLAB/harness-mc/public/data/worktrees.json"), "worktrees input required");
assert.equal(registry.verifier, "npm run test:commit-planning-gate");

for (const field of [
  "repo",
  "repo_status",
  "candidate_task_anchor",
  "preflight_result",
  "commit_groups",
  "excluded_files",
  "verification_commands",
  "risks",
  "approval_required",
]) {
  assert.ok(registry.required_plan_fields.includes(field), `required plan field missing: ${field}`);
}

for (const forbidden of ["git add", "git commit", "git push", "close task", "mutate tasks.json"]) {
  assert.ok(registry.write_boundary.forbidden.includes(forbidden), `forbidden action missing: ${forbidden}`);
}
assert.match(registry.write_boundary.handoff_gate, /worktree-commit/);

const classifications = new Map(registry.classification.map((item) => [item.input_state, item]));
for (const state of ["needs_reconcile", "missing_or_unclear_task_anchor", "task_anchor_available", "local_commits"]) {
  assert.ok(classifications.has(state), `classification missing: ${state}`);
}
assert.equal(classifications.get("needs_reconcile").planning_state, "blocked");
assert.equal(classifications.get("missing_or_unclear_task_anchor").planning_state, "blocked");
assert.equal(classifications.get("task_anchor_available").planning_state, "plan_allowed");
assert.equal(classifications.get("local_commits").planning_state, "push_decision_required");

const decisionText = registry.decision_order.join("\n").toLowerCase();
assert.ok(decisionText.includes("work-anchor preflight"), "decision order must require work-anchor preflight");
assert.ok(decisionText.includes("vincent confirmation"), "decision order must require Vincent confirmation");
assert.ok(decisionText.includes("outside this gate"), "decision order must keep git mutation outside this gate");

for (const phrase of [
  "commit-attention -> commit planning gate -> worktree-commit confirmation gate",
  "The next step is not commit. The next step is planning.",
  "Required Plan Fields",
  "Forbidden",
  "Actual history mutation remains in `worktree-commit`.",
]) {
  assert.ok(spec.includes(phrase), `spec missing phrase: ${phrase}`);
}

console.log("MorroWise commit planning gate verification OK");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
