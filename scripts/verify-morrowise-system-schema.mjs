import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const schemaPath = path.join(root, "system-workflow", "schemas", "morrowise-system.schema.json");
const specPath = path.join(root, "system-workflow", "docs", "specs", "morrowise-anatomy-read-model.md");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function hasRequired(required, key) {
  return Array.isArray(required) && required.includes(key);
}

const schema = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));
const spec = fs.readFileSync(specPath, "utf-8");

const requiredTopLevel = [
  "schema_version",
  "generated_at",
  "source_of_truth",
  "portable_agent_verification",
  "dna",
  "memory",
  "senses",
  "muscles",
  "immune",
  "heartbeat",
  "feedback",
  "open_loops",
];

for (const key of requiredTopLevel) {
  assert(hasRequired(schema.required, key), `schema.required missing ${key}`);
  assert(schema.properties?.[key], `schema.properties missing ${key}`);
}

const defs = schema.$defs || {};
for (const key of [
  "sourceOfTruth",
  "portableAgentVerification",
  "dna",
  "memory",
  "senses",
  "muscles",
  "immune",
  "heartbeat",
  "feedback",
  "openLoop",
  "gate",
  "commitBoundary",
  "dirtyWork",
  "visualSyncGap",
]) {
  assert(defs[key], `schema.$defs missing ${key}`);
}

for (const key of [
  "principle",
  "entry_chain",
  "work_anchor_required",
  "required_checks",
  "handoff_evidence",
]) {
  assert(hasRequired(defs.portableAgentVerification.required, key), `portableAgentVerification missing ${key}`);
}

for (const key of [
  "context",
  "evidence_tags",
  "commit_boundaries",
  "dirty_work",
]) {
  assert(hasRequired(defs.memory.required, key), `memory missing ${key}`);
}

for (const key of [
  "triggers",
  "events",
  "visual_sync_gaps",
  "freshness",
]) {
  assert(hasRequired(defs.senses.required, key), `senses missing ${key}`);
}

for (const key of [
  "gates",
  "task_events",
  "recommendation_candidates",
  "approval_waiting",
]) {
  assert(hasRequired(defs.feedback.required, key), `feedback missing ${key}`);
}

assert(spec.includes("Data belongs to Vincent. AI Agents are replaceable executors."), "spec missing portable data ownership principle");
assert(spec.includes("Future read model target"), "spec missing future read model target");
assert(spec.includes("Minimum v0 Example"), "spec missing minimum example");

console.log("MorroWise system schema verification OK");

