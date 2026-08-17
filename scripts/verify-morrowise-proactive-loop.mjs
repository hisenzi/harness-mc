import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const selfLearningProjectPath = path.join(root, "milestones", "self-learning", "project.json");
const selfLearningTasksPath = path.join(root, "milestones", "self-learning", "tasks.json");
const selfLearningTasks = JSON.parse(fs.readFileSync(selfLearningTasksPath, "utf8")).tasks;
const expectedOpenTaskIds = selfLearningTasks
  .filter((task) => ["todo", "not_started", "in_progress", "doing", "blocked"].includes(task.status))
  .map((task) => task.id)
  .sort();
const selfLearningBefore = digestFiles([selfLearningProjectPath, selfLearningTasksPath]);
execFileSync("node", ["scripts/generate-morrowise-proactive-loop.mjs"], { cwd: root, stdio: "inherit" });
const selfLearningAfter = digestFiles([selfLearningProjectPath, selfLearningTasksPath]);

const readModelPath = path.join(root, "public", "data", "morrowise-proactive-loop.json");
const mockupPath = path.join(root, "system-workflow", "docs", "mockups", "morrowise-proactive-loop.html");
const data = JSON.parse(fs.readFileSync(readModelPath, "utf8"));
const mockup = fs.readFileSync(mockupPath, "utf8");

assert.equal(data.version, 1);
assert.equal(data.read_only, true);
assert.deepEqual(data.stages, ["trigger", "recommendation", "approval", "action", "feedback"]);
assert.equal(data.summary.scenarios, 4);
assert.equal(data.summary.closed, 1);
assert.equal(data.summary.waiting_approval, 2);
assert.equal(data.summary.open_loop, 1);
assert.equal(data.summary.approval_queue, 3);
assert.equal(data.summary.runner_applied_actions, 0);
assert.equal(selfLearningAfter, selfLearningBefore);
assert.ok(data.boundary.includes("cannot close tasks"));
assert.ok(data.source_of_truth.includes("$COLLAB/harness-mc/milestones/harness-mc/tasks.json"));

const requiredScenarios = new Set(["closed_loop", "waiting_approval", "runner_blocked_open_loop", "self_learning_read_only_dogfood"]);
for (const scenario of data.scenarios) {
  requiredScenarios.delete(scenario.scenario_id);
  for (const stage of data.stages) assert.ok(scenario[stage], `${scenario.scenario_id}.${stage} missing`);
  assert.ok(scenario.recommendation.reason);
  assert.ok(Array.isArray(scenario.recommendation.evidence_refs));
  assert.ok(scenario.recommendation.evidence_refs.length > 0);
  assert.ok(["low", "medium", "high"].includes(scenario.approval.risk_level));
  assert.equal(typeof scenario.action.applied, "boolean");
  if (scenario.status !== "closed") {
    assert.equal(scenario.action.output_type, "approval_request");
    assert.equal(scenario.action.applied, false);
  }
}
assert.equal(requiredScenarios.size, 0, `missing scenarios: ${[...requiredScenarios].join(", ")}`);

const dogfood = data.scenarios.find((scenario) => scenario.scenario_id === "self_learning_read_only_dogfood");
assert.equal(dogfood.recommendation.suggested_task_id, "future-practice-roadmap");
assert.equal(dogfood.recommendation.task_governance.candidate_type, "propose_task_reorganization");
assert.equal(dogfood.recommendation.task_governance.target_project, "self-learning");
assert.equal(dogfood.recommendation.task_governance.target_task_source, "$COLLAB/harness-mc/milestones/self-learning/tasks.json");
assert.equal(dogfood.recommendation.task_governance.goal_ref, "$COLLAB/harness-mc/milestones/self-learning/project.json#/goals");
assert.match(dogfood.recommendation.task_governance.goal_fingerprint, /^sha256:[a-f0-9]{64}$/);
assert.equal(dogfood.recommendation.task_governance.proposed_operation, "blocked");
assert.ok(dogfood.recommendation.task_governance.observed_gap.includes("fresh task-level contribution evidence"));
assert.ok(dogfood.recommendation.task_governance.limitations.some((item) => item.includes("Fresh task-level contribution evidence")));
assert.ok(!JSON.stringify(dogfood).includes("item 1"));
assert.equal(dogfood.approval.requires_approval, true);
assert.equal(dogfood.action.applied, false);
assert.equal(dogfood.runner_output.approval_request.task_governance_handoff.write_route, "JV-32/JV-40-after-Vincent-approval");

assert.ok(data.goal_drift_review, "goal_drift_review missing");
assert.equal(data.goal_drift_review.target_project, "self-learning");
assert.equal(data.goal_drift_review.status, "review_required");
assert.match(data.goal_drift_review.current_goal_fingerprint, /^sha256:[a-f0-9]{64}$/);
assert.equal(data.goal_drift_review.reviewed_goal_fingerprint, null);
assert.deepEqual(data.goal_drift_review.open_task_ids.slice().sort(), expectedOpenTaskIds);
assert.deepEqual(data.goal_drift_review.proposals.map((item) => item.task_id).sort(), expectedOpenTaskIds);
assert.ok(data.goal_drift_review.open_task_ids.includes("future-practice-roadmap"));
for (const proposal of data.goal_drift_review.proposals) {
  assert.equal(proposal.proposed_operation, "blocked");
  assert.equal(proposal.requires_approval, true);
  assert.ok(Array.isArray(proposal.evidence_refs) && proposal.evidence_refs.length > 0);
  assert.ok(proposal.limitations.some((item) => item.includes("fresh contribution evidence")));
  assert.ok(!proposal.limitations.some((item) => item.includes("Missing canonical anchor")));
}
assert.equal(data.goal_drift_review.canonical_mutations, 0);
assert.equal(data.goal_drift_review.canonical_deletions, 0);

for (const text of ["正常閉環", "等待審批", "runner blocked", "唯讀邊界", "觸發 → 建議 → 審批 → 動作 → 回饋"]) {
  assert.ok(mockup.includes(text), `mockup missing ${text}`);
}

console.log("MorroWise proactive loop verification OK");

function digestFiles(filePaths) {
  const hash = crypto.createHash("sha256");
  for (const filePath of filePaths) hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}
