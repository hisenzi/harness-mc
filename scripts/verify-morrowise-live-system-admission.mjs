import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const registryPath = path.join(root, "system-workflow", "registries", "morrowise-live-system-admission.json");
const specPath = path.join(root, "system-workflow", "docs", "specs", "morrowise-live-system-admission-gate.md");
const tasksPath = path.join(root, "milestones", "morrowise", "tasks.json");

const registry = readJson(registryPath);
const spec = fs.readFileSync(specPath, "utf8");
const tasks = readJson(tasksPath).tasks;
const taskIds = new Set(tasks.map((task) => task.id));

const admissionStates = new Set(["accepted", "prototype", "blocked", "static_display"]);
const requiredContractFields = [
  "component_id",
  "type",
  "owner_task",
  "loop_role",
  "trigger",
  "source_of_truth",
  "process",
  "output",
  "surface",
  "next_action",
  "feedback_loop",
  "write_boundary",
  "degraded_states",
  "verifier",
  "admission_state",
];

assert.equal(registry.registry_id, "morrowise-live-system-admission.v0");
assert.equal(registry.task_id, "live-system-admission-gate");
assert.equal(registry.status, "formal_registry");
assert.ok(taskIds.has(registry.task_id), "registry task_id must exist in morrowise tasks");
assert.deepEqual(registry.required_contract_fields, requiredContractFields);
assert.ok(Array.isArray(registry.gate_rules) && registry.gate_rules.length >= 5, "gate rules must be explicit");
assert.ok(Array.isArray(registry.components) && registry.components.length > 0, "at least one component fixture required");

for (const state of Object.keys(registry.admission_states || {})) {
  assert.ok(admissionStates.has(state), `unknown admission state: ${state}`);
}

const componentIds = new Set();
for (const component of registry.components) {
  validateRequiredFields(component);
  assert.ok(!componentIds.has(component.component_id), `duplicate component_id: ${component.component_id}`);
  componentIds.add(component.component_id);

  assert.ok(taskIds.has(component.owner_task), `${component.component_id}: owner_task must exist in morrowise tasks`);
  assert.ok(admissionStates.has(component.admission_state), `${component.component_id}: invalid admission_state`);
  assertNonEmpty(component.loop_role, `${component.component_id}: loop_role required`);
  assertNonEmptyArray(component.trigger, `${component.component_id}: trigger required`);
  assertNonEmptyArray(component.source_of_truth, `${component.component_id}: source_of_truth required`);
  assertNonEmptyArray(component.process, `${component.component_id}: process required`);
  assertNonEmptyArray(component.output, `${component.component_id}: output required`);
  assertNonEmptyArray(component.surface, `${component.component_id}: surface required`);
  assertNonEmptyArray(component.next_action, `${component.component_id}: next_action required`);
  assertNonEmptyArray(component.degraded_states, `${component.component_id}: degraded_states required`);
  assertNonEmptyArray(component.verifier, `${component.component_id}: verifier required`);

  assert.ok(component.write_boundary && typeof component.write_boundary === "object", `${component.component_id}: write_boundary object required`);
  assertNonEmptyArray(component.write_boundary.allowed, `${component.component_id}: write_boundary.allowed required`);
  assertNonEmptyArray(component.write_boundary.forbidden, `${component.component_id}: write_boundary.forbidden required`);

  if (component.admission_state === "accepted") {
    assertNonEmptyArray(component.feedback_loop, `${component.component_id}: accepted component requires feedback_loop`);
    assert.ok(component.evidence_refs?.length > 0, `${component.component_id}: accepted component requires evidence_refs`);
  }

  if (!component.feedback_loop?.length) {
    assert.notEqual(component.admission_state, "accepted", `${component.component_id}: missing feedback_loop cannot be accepted`);
  }
}

const commitAttention = registry.components.find((component) => component.component_id === "commit-attention");
assert.ok(commitAttention, "commit-attention fixture required");
assert.equal(commitAttention.admission_state, "accepted");
assert.equal(commitAttention.owner_task, "runtime-scheduler-v0");
assert.ok(commitAttention.verifier.includes("npm run test:commit-attention"), "commit-attention must keep its own verifier");
for (const forbidden of ["stage files", "commit", "push", "close task", "read secrets"]) {
  assert.ok(commitAttention.write_boundary.forbidden.includes(forbidden), `commit-attention must forbid ${forbidden}`);
}
assert.match(commitAttention.write_boundary.commit_gate, /worktree-commit/);
assert.match(commitAttention.write_boundary.approval_gate, /morrowise-approval-policy/);
assert.ok(
  commitAttention.feedback_loop.some((item) => item.includes("worktree-commit")),
  "commit-attention feedback loop must route through worktree-commit",
);
assert.ok(
  commitAttention.degraded_states.includes("missing_or_unclear_task_anchor"),
  "commit-attention must represent missing task anchors as degraded state",
);

for (const phrase of [
  "trigger -> source -> process -> output -> surface -> next_action -> feedback_loop -> verifier",
  "Admission States",
  "Required Contract",
  "Gate Rules",
  "commit-attention",
  "worktree-commit",
]) {
  assert.ok(spec.includes(phrase), `spec missing phrase: ${phrase}`);
}

console.log("MorroWise live-system admission verification OK");

function validateRequiredFields(component) {
  for (const field of requiredContractFields) {
    assert.ok(Object.hasOwn(component, field), `${component.component_id || "component"} missing ${field}`);
  }
}

function assertNonEmpty(value, message) {
  assert.equal(typeof value, "string", message);
  assert.ok(value.trim().length > 0, message);
}

function assertNonEmptyArray(value, message) {
  assert.ok(Array.isArray(value), message);
  assert.ok(value.length > 0, message);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
