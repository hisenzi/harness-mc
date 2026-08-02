import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const registryPath = path.join(root, "system-workflow", "registries", "morrowise-recommendation-engine.json");
const triggerRegistryPath = path.join(root, "system-workflow", "registries", "morrowise-trigger-rules.json");
const schemaPath = path.join(root, "system-workflow", "schemas", "morrowise-system.schema.json");
const specPath = path.join(root, "system-workflow", "docs", "specs", "morrowise-recommendation-engine.md");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

const registry = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
const triggerRegistry = JSON.parse(fs.readFileSync(triggerRegistryPath, "utf-8"));
const schema = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));
const spec = fs.readFileSync(specPath, "utf-8");

assert(registry.engine_id === "morrowise-recommendation-engine.v0", "unexpected engine_id");
assert(registry.task_id === "morrowise-recommendation-engine-v0", "unexpected task_id");
assert(registry.boundary?.may_execute_actions === false, "engine must not execute actions");
assert(registry.boundary?.may_close_tasks === false, "engine must not close tasks");
assert(registry.boundary?.may_write_external_systems === false, "engine must not write external systems");
assert(registry.boundary?.next_owner === "morrowise-approval-policy", "next owner must be approval policy");

const requiredCandidateFields = [
  "recommendation_id",
  "trigger_id",
  "reason",
  "suggested_action",
  "suggested_task_id",
  "evidence_refs",
  "risk_level",
  "requires_approval",
  "hc_refs",
  "hc_reasoning",
  "hc_confidence",
];

for (const field of requiredCandidateFields) {
  assert(registry.candidate_contract?.required_fields?.includes(field), `candidate contract missing field: ${field}`);
}

assert(registry.hc_router?.status === "connected_as_method_selector", "HC router must be connected as method selector");
assert(nonEmpty(registry.hc_router?.source), "HC router source required");
assert(nonEmpty(registry.hc_router?.router_ref), "HC router ref required");

const requiredHcRefs = ["#rightProblem", "#breakItDown", "#risk", "#utility", "#confirmationBias", "#systemDynamics"];
for (const hc of requiredHcRefs) {
  assert(registry.hc_router.default_refs.some((entry) => entry.hc === hc), `HC router missing ${hc}`);
}

const triggerIds = new Set(triggerRegistry.triggers.map((trigger) => trigger.trigger_id));
const recommendationTypes = new Set(registry.recommendation_types.map((type) => type.type));
for (const type of ["commit_now", "split_commit", "wait_for_approval", "create_task_event", "refresh_visual_layer", "dry_run_external_sync", "request_external_write_approval", "create_open_loop"]) {
  assert(recommendationTypes.has(type), `recommendation type missing: ${type}`);
}

const recommendationIds = new Set();
for (const candidate of registry.sample_candidates) {
  assert(nonEmpty(candidate.recommendation_id), "candidate recommendation_id required");
  assert(!recommendationIds.has(candidate.recommendation_id), `duplicate recommendation_id: ${candidate.recommendation_id}`);
  recommendationIds.add(candidate.recommendation_id);
  assert(triggerIds.has(candidate.trigger_id), `${candidate.recommendation_id}: unknown trigger_id ${candidate.trigger_id}`);
  assert(nonEmpty(candidate.reason), `${candidate.recommendation_id}: reason required`);
  assert(recommendationTypes.has(candidate.suggested_action), `${candidate.recommendation_id}: suggested_action not in recommendation_types`);
  assert(nonEmpty(candidate.suggested_task_id), `${candidate.recommendation_id}: suggested_task_id required`);
  assert(Array.isArray(candidate.evidence_refs) && candidate.evidence_refs.length > 0, `${candidate.recommendation_id}: evidence_refs required`);
  assert(["low", "medium", "high"].includes(candidate.risk_level), `${candidate.recommendation_id}: invalid risk_level`);
  assert(typeof candidate.requires_approval === "boolean", `${candidate.recommendation_id}: requires_approval must be boolean`);
  assert(Array.isArray(candidate.hc_refs) && candidate.hc_refs.length > 0, `${candidate.recommendation_id}: hc_refs required`);
  assert(nonEmpty(candidate.hc_reasoning), `${candidate.recommendation_id}: hc_reasoning required`);
  assert(typeof candidate.hc_confidence === "number" && candidate.hc_confidence >= 0 && candidate.hc_confidence <= 1, `${candidate.recommendation_id}: hc_confidence must be 0..1`);

  for (const evidence of candidate.evidence_refs) {
    assert(nonEmpty(evidence.type) && nonEmpty(evidence.ref), `${candidate.recommendation_id}: evidence type/ref required`);
  }

  for (const hc of candidate.hc_refs) {
    assert(requiredHcRefs.includes(hc), `${candidate.recommendation_id}: unknown HC ref ${hc}`);
  }

  if (candidate.risk_level === "high") {
    assert(candidate.requires_approval === true, `${candidate.recommendation_id}: high-risk candidates require approval`);
  }
}

const schemaCandidate = schema.$defs?.recommendationCandidate;
assert(schemaCandidate, "schema missing recommendationCandidate definition");
for (const field of requiredCandidateFields) {
  assert(schemaCandidate.required.includes(field), `schema recommendationCandidate.required missing ${field}`);
  assert(schemaCandidate.properties[field], `schema recommendationCandidate.properties missing ${field}`);
}

const taskGovernance = registry.task_governance_contract;
assert(taskGovernance, "registry missing task_governance_contract");
assert(taskGovernance.may_propose_only === true, "task governance must be proposal-only");
assert(taskGovernance.may_mutate_canonical_tasks === false, "task governance must not mutate canonical tasks");
assert(taskGovernance.write_route === "JV-32/JV-40-after-Vincent-approval", "unexpected task governance write route");

const requiredGovernanceFields = [
  "target_project",
  "target_task_source",
  "goal_ref",
  "source_task_refs",
  "evidence_refs",
  "observed_gap",
  "proposed_operation",
  "proposed_done_condition",
  "limitations",
  "requires_approval",
];
for (const field of requiredGovernanceFields) {
  assert(taskGovernance.required_fields?.includes(field), `task governance contract missing field: ${field}`);
}
for (const type of ["propose_next_task", "propose_task_reorganization"]) {
  assert(taskGovernance.candidate_types?.includes(type), `task governance candidate type missing: ${type}`);
}
for (const operation of ["create", "retain", "amend", "defer", "cancel", "replace", "blocked"]) {
  assert(taskGovernance.proposed_operations?.includes(operation), `task governance operation missing: ${operation}`);
}

assert(Array.isArray(registry.task_governance_sample_candidates), "task governance samples required");
assert(registry.task_governance_sample_candidates.length >= 2, "next-task and reorganization samples required");
for (const candidate of registry.task_governance_sample_candidates) {
  for (const field of requiredGovernanceFields) {
    assert(candidate[field] !== undefined && candidate[field] !== null, `${candidate.recommendation_id || "governance candidate"}: missing ${field}`);
  }
  assert(candidate.requires_approval === true, `${candidate.recommendation_id}: governance candidate must require approval`);
  assert(nonEmpty(candidate.target_project), `${candidate.recommendation_id}: target_project required`);
  assert(candidate.target_task_source === `$COLLAB/harness-mc/milestones/${candidate.target_project}/tasks.json`, `${candidate.recommendation_id}: target_task_source must be target canonical tasks.json`);
  assert(nonEmpty(candidate.goal_ref), `${candidate.recommendation_id}: goal_ref required`);
  assert(Array.isArray(candidate.source_task_refs) && candidate.source_task_refs.length > 0, `${candidate.recommendation_id}: source_task_refs required`);
  assert(Array.isArray(candidate.evidence_refs) && candidate.evidence_refs.length > 0, `${candidate.recommendation_id}: evidence_refs required`);
  assert(nonEmpty(candidate.observed_gap), `${candidate.recommendation_id}: observed_gap required`);
  assert(taskGovernance.proposed_operations.includes(candidate.proposed_operation), `${candidate.recommendation_id}: invalid proposed_operation`);
  assert(nonEmpty(candidate.proposed_done_condition), `${candidate.recommendation_id}: proposed_done_condition required`);
  assert(Array.isArray(candidate.limitations) && candidate.limitations.length > 0, `${candidate.recommendation_id}: limitations required`);
}

const governanceSchema = schema.$defs?.taskGovernanceRecommendationCandidate;
assert(governanceSchema, "schema missing taskGovernanceRecommendationCandidate definition");
for (const field of requiredGovernanceFields) {
  assert(governanceSchema.required.includes(field), `taskGovernanceRecommendationCandidate.required missing ${field}`);
  assert(governanceSchema.properties[field], `taskGovernanceRecommendationCandidate.properties missing ${field}`);
}

for (const phrase of [
  "Machine-readable registry",
  "Candidate Contract",
  "HC Router Decision",
  "Evidence refs are mandatory",
  "High-risk candidates always require approval",
  "Task Governance R17 Contract",
  "MorroWise may propose; Vincent approves; an Agent writes through JV-32/JV-40.",
  "No task-governance candidate may mutate a canonical `tasks.json`",
  "`propose_next_task`",
  "`propose_task_reorganization`",
  "npm run test:morrowise-recommendations",
]) {
  assert(spec.includes(phrase), `spec missing phrase: ${phrase}`);
}

console.log("MorroWise recommendation engine verification OK");
