import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const collabRoot = path.resolve(root, "..");

const registryPath = path.join(root, "system-workflow", "registries", "morrowise-reality-tax-gate.json");
const tasksPath = path.join(root, "milestones", "morrowise", "tasks.json");
const protocolPath = path.join(collabRoot, "notyet-harness", "000_Agent", "docs", "morrowise", "reality-tax-gate-protocol.md");
const manualPath = path.join(collabRoot, "notyet-harness", "000_Agent", "docs", "morrowise", "MANUAL.md");

const registry = readJson(registryPath);
const tasks = readJson(tasksPath).tasks || [];
const task = tasks.find((item) => item.id === "reality-tax-gate-protocol");

assert.ok(task, "reality-tax-gate-protocol task must exist");
assert.equal(registry.gate_id, "morrowise-reality-tax-gate.v0");
assert.equal(registry.task_id, "reality-tax-gate-protocol");
assert.equal(registry.status, "protocol_ready");
assert.equal(registry.read_only, true);
assert.equal(registry.trigger.same_concept_minutes, 30);
assert.equal(registry.trigger.requires_output_within_hours, 24);
assert.equal(registry.boundaries.gate_is, "workflow_gate");
assert.equal(registry.boundaries.daily_review_is, "scheduler_task");
assert.equal(registry.boundaries.daily_review_task_id, "reality-tax-daily-review-task");
assert.equal(registry.boundaries.delivery_adapter_contract, "notification-adapter-contract");
assert.ok(registry.boundaries.forbidden.includes("treat delivery success as task completion"));
assert.ok(registry.boundaries.forbidden.includes("treat HC reasoning as task state"));

const routeIds = registry.routes.map((route) => route.id);
assert.deepEqual(routeIds, [
  "attach_output",
  "create_task_anchor",
  "make_small_demo",
  "kill_loop",
  "mark_reality_gap",
]);
for (const route of registry.routes) {
  assertNonEmptyArray(route.required_fields, `${route.id} required_fields must not be empty`);
}

const expectedOutputs = [
  "task",
  "demo",
  "flow_diagram",
  "dashboard",
  "decision_log",
  "customer_validation_question",
  "public_commitment",
  "verifier",
  "article_draft",
  "pitch",
];
assert.deepEqual(registry.acceptable_outputs, expectedOutputs);
for (const forbidden of ["research_more", "think_later", "keep_monitoring", "we_should_consider", "unanchored_chat_summary"]) {
  assert.ok(registry.non_outputs.includes(forbidden), `non_outputs missing ${forbidden}`);
}

const requiredHcRefs = ["#rightProblem", "#constraints", "#utility", "#risk", "#systemDynamics", "#responsibility"];
assert.deepEqual(registry.hc_layer.required_refs, requiredHcRefs);
assert.equal(registry.hc_layer.role, "reasoning_support_only");
for (const forbidden of ["close_task", "overwrite_tasks_json", "bypass_approval_policy", "send_notification", "commit_or_push", "replace_verifier_evidence"]) {
  assert.ok(registry.hc_layer.forbidden_authority.includes(forbidden), `HC forbidden authority missing ${forbidden}`);
}
assert.deepEqual(registry.record_shape.hc_refs, requiredHcRefs);
assert.match(registry.record_shape.hc_boundary, /reasoning support only/i);

for (const phrase of [
  "Reality Tax Gate",
  "Reality Tax Daily Review",
  "#rightProblem",
  "#constraints",
  "#utility",
  "#risk",
  "#systemDynamics",
  "#responsibility",
]) {
  assert.ok(task.done_condition.includes("Reality Tax Gate") || JSON.stringify(task).includes(phrase), `task should expose ${phrase}`);
}

if (fs.existsSync(protocolPath)) {
  const protocol = fs.readFileSync(protocolPath, "utf8");
  for (const phrase of [
    "more than 30 minutes",
    "within 24 hours",
    "mark_reality_gap",
    "Reality Tax Daily Review is a scheduled task",
    "HC reasoning cannot",
    "customer validation question",
  ]) {
    assert.ok(protocol.includes(phrase), `protocol doc missing ${phrase}`);
  }
}

if (fs.existsSync(manualPath)) {
  const manual = fs.readFileSync(manualPath, "utf8");
  assert.ok(manual.includes("reality-tax-gate-protocol.md"), "MorroWise manual must link to Reality Tax Gate protocol");
  assert.ok(manual.includes("Reality Tax Gate 是 workflow gate"), "MorroWise manual must distinguish gate from daily review");
}

console.log("MorroWise Reality Tax Gate protocol verification OK");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function assertNonEmptyArray(value, message) {
  assert.ok(Array.isArray(value), message);
  assert.ok(value.length > 0, message);
}
