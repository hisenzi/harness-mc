import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const registryPath = path.join(root, "system-workflow", "registries", "morrowise-trigger-rules.json");
const specPath = path.join(root, "system-workflow", "docs", "specs", "morrowise-trigger-rules-registry.md");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

const registry = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
const spec = fs.readFileSync(specPath, "utf-8");

assert(registry.registry_id === "morrowise-trigger-rules.v0", "unexpected registry_id");
assert(registry.task_id === "morrowise-trigger-rules-registry", "unexpected task_id");
assert(registry.boundary?.may_execute_actions === false, "registry must not execute actions directly");
assert(Array.isArray(registry.required_trigger_families), "required_trigger_families must be an array");
assert(Array.isArray(registry.triggers), "triggers must be an array");

const requiredFamilies = [
  "stale_blocked_task",
  "sync_failed",
  "rejected_event",
  "weekly_review",
  "session_startup",
  "project_init_growth_gate_missing",
];

for (const family of requiredFamilies) {
  assert(registry.required_trigger_families.includes(family), `required family missing from registry metadata: ${family}`);
  assert(registry.triggers.some((trigger) => trigger.family === family), `no trigger implements family: ${family}`);
}

const triggerIds = new Set();
for (const trigger of registry.triggers) {
  assert(nonEmpty(trigger.trigger_id), "trigger_id must be non-empty");
  assert(!triggerIds.has(trigger.trigger_id), `duplicate trigger_id: ${trigger.trigger_id}`);
  triggerIds.add(trigger.trigger_id);

  assert(nonEmpty(trigger.family), `${trigger.trigger_id}: family must be non-empty`);
  assert(trigger.source && nonEmpty(trigger.source.type) && nonEmpty(trigger.source.ref), `${trigger.trigger_id}: source.type/ref required`);
  assert(nonEmpty(trigger.condition), `${trigger.trigger_id}: condition required`);
  assert(nonEmpty(trigger.cooldown), `${trigger.trigger_id}: cooldown required`);
  assert(trigger.output_event && nonEmpty(trigger.output_event.type), `${trigger.trigger_id}: output_event.type required`);
  assert(nonEmpty(trigger.output_event.target), `${trigger.trigger_id}: output_event.target required`);
  assert(Array.isArray(trigger.output_event.payload), `${trigger.trigger_id}: output_event.payload must be an array`);
  assert(nonEmpty(trigger.next_step), `${trigger.trigger_id}: next_step required`);
  assert(["low", "medium", "high"].includes(trigger.risk_level), `${trigger.trigger_id}: risk_level invalid`);

  if (trigger.risk_level === "high") {
    const text = `${trigger.next_step} ${trigger.output_event.type} ${trigger.output_event.target}`.toLowerCase();
    assert(!text.includes("execute external write"), `${trigger.trigger_id}: high-risk trigger must not execute external write`);
  }
}

for (const phrase of [
  "Machine-readable registry",
  "Triggers may not",
  "Required Trigger Families",
  "Output events are recommendation inputs, not actions",
  "npm run test:morrowise-triggers",
  "morrowise-recommendation-engine-v0",
]) {
  assert(spec.includes(phrase), `spec missing phrase: ${phrase}`);
}

console.log("MorroWise trigger rules registry verification OK");

