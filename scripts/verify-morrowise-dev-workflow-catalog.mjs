import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const collabRoot = path.resolve(root, "..");

const registryPath = path.join(root, "system-workflow", "registries", "morrowise-dev-workflow-catalog.json");
const schemaPath = path.join(root, "system-workflow", "schemas", "morrowise-dev-workflow.schema.json");
const taskLifecycleSchemaPath = path.join(root, "system-workflow", "schemas", "morrowise-task-lifecycle.schema.json");
const sourceMapPath = path.join(root, "system-workflow", "docs", "specs", "morrowise-dev-workflow-source-map.md");
const detailDocPath = path.join(root, "system-workflow", "docs", "specs", "morrowise-dev-workflow-catalog.md");
const taskLifecycleDocPath = path.join(root, "system-workflow", "docs", "specs", "morrowise-task-lifecycle.md");
const taskWriteMapPath = path.join(root, "system-workflow", "docs", "task-write-command-map.md");
const approvalPolicyPath = path.join(root, "system-workflow", "registries", "morrowise-approval-policy.json");
const generatorPath = path.join(root, "scripts", "generate-morrowise-dev-workflows.mjs");
const readModelPath = path.join(root, "public", "data", "morrowise-dev-workflows.json");
const tasksPath = path.join(root, "milestones", "morrowise", "tasks.json");
const architectureRegistryPath = path.join(root, "system-workflow", "registries", "morrowise-architecture-subsystems.json");
const wiringGatePath = path.join(root, "system-workflow", "registries", "morrowise-wiring-gate.json");
const packageJsonPath = path.join(root, "package.json");

const WORKFLOW_STATUSES = new Set(["accepted", "prototype", "blocked", "deferred", "adapter_only"]);
const REQUIRED_WORKFLOW_FIELDS = [
  "id",
  "phase",
  "source_doc",
  "source_skill",
  "trigger",
  "inputs",
  "process",
  "outputs",
  "writes_to",
  "external_effect",
  "approval_policy",
  "morrowise_stage",
  "close_rule",
  "verifier_ref",
  "status",
  "owner_task",
  "notes",
];
const REQUIRED_WORKFLOW_IDS = [
  "ask-matt",
  "grill-me",
  "grill-with-docs",
  "domain-modeling",
  "to-prd",
  "to-issues",
  "implement",
  "tdd",
  "code-review",
  "diagnosing-bugs",
  "research",
  "prototype",
  "improve-codebase-architecture",
  "triage",
  "task-lifecycle",
  "resolving-merge-conflicts",
  "closeout-commit-routing",
];
const FORBIDDEN_REF_PATTERNS = [
  /\/Users\/[A-Za-z0-9._-]+\//,
  /secrets?\//i,
  /token/i,
  /cookie/i,
  /runtime[-_\s]?auth/i,
  /browser[-_\s]?cookies/i,
];
const EXTERNAL_TRACKER_WRITE_PATTERN = /\b(?:github|gitlab)[_\s-]?(?:issues?|tracker)|external\s+(?:issue\s+)?tracker\b/i;
const CONTROL_CONTRACT_SCHEMA_REF = "$COLLAB/harness-mc/system-workflow/schemas/morrowise-dev-workflow.schema.json#/$defs/control_plane_contract";
const LOOP_POLICY_SCHEMA_REF = "$COLLAB/harness-mc/system-workflow/schemas/morrowise-dev-workflow.schema.json#/$defs/loop_policy_contract";
const HARNESS_MECHANISMS = [
  "context_management",
  "tool_execution",
  "sandbox_enforcement",
  "permission_enforcement",
  "state_persistence",
  "observability",
  "error_recovery",
  "retry_mechanism",
];
const HARNESS_FORBIDDEN_POLICY_AUTHORITY = [
  "trigger_decision",
  "objective_decision",
  "discovery_decision",
  "prioritization_decision",
  "verification_gate_decision",
  "retry_decision",
  "memory_writeback_decision",
  "escalation_decision",
  "terminal_state_decision",
  "resource_budget_decision",
];
const LOOP_POLICY_FIELDS = [
  "role",
  "trigger",
  "objective",
  "input_state",
  "discovery_policy",
  "prioritization_policy",
  "execution_roles",
  "context_policy",
  "verification_policy",
  "retry_policy",
  "memory_writeback",
  "escalation_conditions",
  "terminal_states",
  "resource_budget",
  "forbidden_harness_bypass",
];
const LOOP_TERMINAL_STATES = [
  "DONE_VERIFIED",
  "DONE_WITH_WARNINGS",
  "BLOCKED_MISSING_INPUT",
  "BLOCKED_EXTERNAL_DEPENDENCY",
  "FAILED_RETRY_EXHAUSTED",
  "ESCALATED_RISK",
  "ABORTED_SCOPE_DRIFT",
];
const LOOP_FORBIDDEN_HARNESS_BYPASS = [
  "sandbox_bypass",
  "permission_bypass",
  "tool_boundary_bypass",
  "context_boundary_bypass",
];
const CONTROL_BOUNDARY_INVARIANTS = [
  "harness_provides_mechanisms_only",
  "loop_owns_policy_decisions",
  "loop_cannot_bypass_harness",
  "evidence_required_before_done",
  "loop_terminal_state_does_not_mutate_task_status",
];
const JV32_PREBUILD_CONTRACT_REF = "$COLLAB/harness-mc/package.json#jv32-prebuild-contract";
const ARCHITECTURE_VERSION_REVIEW_REFS = [
  "$COLLAB/harness-mc/system-workflow/registries/morrowise-dev-workflow-catalog.json",
  "$COLLAB/harness-mc/system-workflow/schemas/morrowise-dev-workflow.schema.json",
  "$COLLAB/harness-mc/system-workflow/schemas/morrowise-task-lifecycle.schema.json",
  "$COLLAB/harness-mc/system-workflow/docs/specs/morrowise-dev-workflow-catalog.md",
  "$COLLAB/harness-mc/system-workflow/docs/specs/morrowise-task-lifecycle.md",
  "$COLLAB/harness-mc/system-workflow/docs/specs/morrowise-dev-workflow-source-map.md",
  "$COLLAB/harness-mc/system-workflow/docs/task-write-command-map.md",
  "$COLLAB/harness-mc/system-workflow/registries/morrowise-approval-policy.json",
  "$COLLAB/harness-mc/system-workflow/registries/morrowise-wiring-gate.json",
  "$COLLAB/harness-mc/scripts/validate-tasks.mjs",
  "$COLLAB/harness-mc/scripts/verify-validate-tasks.mjs",
  "$COLLAB/harness-mc/scripts/work-anchor-preflight.mjs",
  "$COLLAB/harness-mc/scripts/verify-work-anchor-preflight.mjs",
  JV32_PREBUILD_CONTRACT_REF,
  "$COLLAB/harness-mc/scripts/generate-morrowise-dev-workflows.mjs",
  "$COLLAB/harness-mc/scripts/verify-morrowise-dev-workflow-catalog.mjs",
];

const packageJson = readJson(packageJsonPath);
const prebuild = packageJson.scripts?.prebuild || "";
const devWorkflowGenerator = "node scripts/generate-morrowise-dev-workflows.mjs";
const catalogVerifier = "node scripts/verify-morrowise-dev-workflow-catalog.mjs";
const liveDashboardGenerator = "node scripts/generate-morrowise-live-dashboard.mjs";
const JV32_PREBUILD_COMMANDS = [devWorkflowGenerator, catalogVerifier, liveDashboardGenerator];
const devWorkflowGeneratorIndex = prebuild.indexOf(devWorkflowGenerator);
const catalogVerifierIndex = prebuild.indexOf(catalogVerifier);
const liveDashboardGeneratorIndex = prebuild.indexOf(liveDashboardGenerator);
assert.notEqual(
  devWorkflowGeneratorIndex,
  -1,
  "prebuild must generate the JV-32 read model before dashboard generation and catalog verification",
);
assert.notEqual(catalogVerifierIndex, -1, "prebuild must verify the generated JV-32 read model");
assert.notEqual(liveDashboardGeneratorIndex, -1, "prebuild must generate the MorroWise live dashboard");
assert.ok(
  devWorkflowGeneratorIndex < catalogVerifierIndex,
  "prebuild must verify the JV-32 read model after generating it",
);
assert.ok(
  catalogVerifierIndex < liveDashboardGeneratorIndex,
  "prebuild must verify the JV-32 read model before the dashboard consumes it",
);

for (const file of [registryPath, schemaPath, taskLifecycleSchemaPath, sourceMapPath, detailDocPath, taskLifecycleDocPath, taskWriteMapPath, approvalPolicyPath, generatorPath, readModelPath]) {
  assert.ok(fs.existsSync(file), `required JV-32 artifact missing: ${path.relative(root, file)}`);
}

const registry = readJson(registryPath);
const schema = readJson(schemaPath);
const taskLifecycleSchema = readJson(taskLifecycleSchemaPath);
const readModel = readJson(readModelPath);
const tasks = readJson(tasksPath).tasks || [];
const architectureRegistry = readJson(architectureRegistryPath);
const wiringGate = readJson(wiringGatePath);
const sourceMap = fs.readFileSync(sourceMapPath, "utf8");
const detailDoc = fs.readFileSync(detailDocPath, "utf8");
const taskLifecycleDoc = fs.readFileSync(taskLifecycleDocPath, "utf8");
const taskWriteMap = fs.readFileSync(taskWriteMapPath, "utf8");
const approvalPolicy = readJson(approvalPolicyPath);
const taskIds = new Set(tasks.map((task) => task.id));

verifyPortableSourceReferenceFixtures(registry);
verifyRegistry(registry);
verifySchema(schema);
verifyControlPlaneContractSchema(schema);
verifyControlPlaneContract(registry.control_plane_contract, schema);
verifyTaskLifecycleSchema(taskLifecycleSchema);
verifyDocs(sourceMap, detailDoc, taskLifecycleDoc);
verifyTaskLifecycleGovernance(taskWriteMap, approvalPolicy);
verifyReadModel(readModel, registry);
verifyTaskState(tasks);
verifyArchitectureAdmission(architectureRegistry);
verifyWiringFixture(wiringGate);
verifyNegativeFixtures(registry);
verifyControlPlaneNegativeFixtures(schema);
verifyArchitectureFingerprintBoundary();

console.log("MorroWise dev workflow catalog verification OK");

function verifyPortableSourceReferenceFixtures(value) {
  const first = structuredClone(value.workflows[0]);

  assert.doesNotThrow(
    () => validateWorkflow({
      ...first,
      source_doc: "$COLLAB/.tmp/ci-missing-intake.md",
      source_skill: "$COLLAB/harness-mc/package.json",
    }),
    "missing external intake evidence must not block a single-repo verification",
  );
  assert.doesNotThrow(
    () => validateWorkflow({
      ...first,
      source_doc: "$COLLAB/harness-mc/package.json",
      source_skill: "$COLLAB/notyet-harness/000_Agent/skills/ci-missing/SKILL.md",
    }),
    "missing cross-repo source evidence must not block a single-repo verification",
  );
  assert.throws(
    () => validateWorkflow({ ...first, source_doc: "$COLLAB/harness-mc/ci-missing-canonical.md" }),
    /ref does not resolve/,
    "missing harness-owned source must remain a verification failure",
  );
  assert.throws(
    () => validateWorkflow({ ...first, source_doc: "$COLLAB/harness-mc/../notyet-harness/ci-missing-source.md" }),
    /path traversal/,
    "path traversal must not reclassify external provenance as a canonical source",
  );
}

function verifyRegistry(value) {
  assert.equal(value.registry_id, "morrowise-dev-workflow-catalog.v0");
  assert.equal(value.task_id, "morrowise-dev-workflow-catalog");
  assert.equal(value.status, "governed_catalog");
  assert.equal(value.source_of_truth, "$COLLAB/harness-mc/system-workflow/registries/morrowise-dev-workflow-catalog.json");
  assert.equal(value.schema_ref, "$COLLAB/harness-mc/system-workflow/schemas/morrowise-dev-workflow.schema.json");
  assert.equal(value.task_lifecycle_schema_ref, "$COLLAB/harness-mc/system-workflow/schemas/morrowise-task-lifecycle.schema.json");
  assert.equal(value.verifier_ref, "node scripts/verify-morrowise-dev-workflow-catalog.mjs");
  assert.equal(value.generator_ref, "$COLLAB/harness-mc/scripts/generate-morrowise-dev-workflows.mjs");
  assert.equal(value.read_model_ref, "$COLLAB/harness-mc/public/data/morrowise-dev-workflows.json");
  assert.deepEqual(value.status_vocabulary, [...WORKFLOW_STATUSES]);
  assert.deepEqual(value.required_workflow_fields, REQUIRED_WORKFLOW_FIELDS);
  assert.ok(Array.isArray(value.workflows), "workflows must be an array");

  const seen = new Set();
  for (const workflow of value.workflows) {
    validateWorkflow(workflow);
    assert.equal(seen.has(workflow.id), false, `duplicate workflow id: ${workflow.id}`);
    seen.add(workflow.id);
  }

  for (const id of REQUIRED_WORKFLOW_IDS) {
    assert.ok(seen.has(id), `required workflow missing: ${id}`);
  }

  assert.equal(value.exclusions?.find((item) => item.id === "setup-matt-pocock-skills")?.reason.includes("installer"), true, "setup installer must be excluded with reason");

  const grillMe = value.workflows.find((item) => item.id === "grill-me");
  assert.equal(grillMe.morrowise_stage, "pre_workflow_stress_test");
  assert.equal(grillMe.status, "accepted");

  const grillWithDocs = value.workflows.find((item) => item.id === "grill-with-docs");
  assert.equal(grillWithDocs.morrowise_stage, "workflow_start");
  assert.equal(grillWithDocs.status, "accepted");

  const toIssues = value.workflows.find((item) => item.id === "to-issues");
  assert.equal(toIssues.status, "adapter_only");
  assert.ok(String(toIssues.writes_to).includes("tasks.json"), "to-issues must keep MorroWise canonical task state");

  const taskLifecycle = value.workflows.find((item) => item.id === "task-lifecycle");
  assert.equal(taskLifecycle.status, "accepted");
  assert.equal(taskLifecycle.morrowise_stage, "task_lifecycle_gate");
  assert.match(taskLifecycle.writes_to, /tasks\.json|task-events/, "task-lifecycle must target canonical task state");
  assert.equal(taskLifecycle.external_effect, "none");
  assert.match(taskLifecycle.close_rule, /reason|evidence|closeout/i, "task-lifecycle must require durable mutation evidence");
  assert.match(taskLifecycle.close_rule, /Admission Record|architecture sync/i, "task-lifecycle must gate promoted-subsystem version reviews");
  assert.match(`${taskLifecycle.process} ${taskLifecycle.outputs}`, /semantic_intake|semantic intake/i, "task-lifecycle must enforce semantic task intake");
  assert.match(`${taskLifecycle.process} ${taskLifecycle.close_rule}`, /weekly_core|weekly core/i, "task-lifecycle must enforce the weekly core review gate");
  assert.match(taskLifecycle.verifier_ref, /verify-work-anchor-preflight\.mjs/, "task-lifecycle verifier chain must include the runtime preflight fixture");

  const closeoutCommit = value.workflows.find((item) => item.id === "closeout-commit-routing");
  assert.equal(closeoutCommit.status, "accepted");
  assert.equal(closeoutCommit.phase, "closeout");
  assert.equal(closeoutCommit.morrowise_stage, "workflow_closeout");
  assert.match(`${closeoutCommit.process} ${closeoutCommit.close_rule}`, /verification-before-completion/);
  assert.match(`${closeoutCommit.process} ${closeoutCommit.close_rule}`, /cc-log/);
  assert.match(`${closeoutCommit.process} ${closeoutCommit.close_rule}`, /worktree-commit/);
  assert.match(`${closeoutCommit.outputs} ${closeoutCommit.close_rule}`, /task completion evidence|completed_at|commits|summary/i);
}

function validateWorkflow(workflow) {
  for (const field of REQUIRED_WORKFLOW_FIELDS) {
    assert.ok(Object.hasOwn(workflow, field), `${workflow.id || "(missing id)"} missing ${field}`);
  }

  assert.ok(WORKFLOW_STATUSES.has(workflow.status), `${workflow.id} invalid status`);
  assert.ok(taskIds.has(workflow.owner_task), `${workflow.id} owner_task must exist`);
  assert.ok(workflow.close_rule, `${workflow.id} close_rule required`);
  assert.ok(workflow.verifier_ref, `${workflow.id} verifier_ref required`);
  assert.ok(workflow.notes, `${workflow.id} notes required`);

  for (const ref of [workflow.source_doc, workflow.source_skill].filter(Boolean)) {
    assertSafeRef(workflow.id, ref);
    assertWorkflowSourceRef(workflow.id, ref);
  }

  if (String(workflow.external_effect).match(/install|hooks_modify/i)) {
    throw new Error(`${workflow.id} external_effect cannot be install or hooks_modify`);
  }

  if (hasExternalTrackerWrite(workflow.writes_to)) {
    assert.equal(workflow.status, "adapter_only", `${workflow.id} external issue tracker writes must be adapter_only`);
  }
}

function verifySchema(value) {
  assert.equal(value.$id, "https://hisenzi.local/schemas/morrowise-dev-workflow.schema.json");
  assert.deepEqual(value.properties.status.enum, [...WORKFLOW_STATUSES]);
  for (const field of REQUIRED_WORKFLOW_FIELDS) {
    assert.ok(value.required.includes(field), `schema missing required field: ${field}`);
  }
}

function verifyControlPlaneContractSchema(value) {
  const harness = value.$defs?.harness_contract;
  const loop = value.$defs?.loop_policy_contract;
  const control = value.$defs?.control_plane_contract;
  assert.ok(harness, "schema missing $defs.harness_contract");
  assert.ok(loop, "schema missing $defs.loop_policy_contract");
  assert.ok(control, "schema missing $defs.control_plane_contract");
  assert.equal(harness.additionalProperties, false, "harness contract must be closed");
  assert.equal(loop.additionalProperties, false, "loop policy contract must be closed");
  assert.equal(control.additionalProperties, false, "control plane contract must be closed");
  assert.deepEqual(harness.properties.mechanisms.items.enum, HARNESS_MECHANISMS);
  assert.deepEqual(harness.properties.forbidden_policy_authority.items.enum, HARNESS_FORBIDDEN_POLICY_AUTHORITY);
  assert.deepEqual(loop.required, LOOP_POLICY_FIELDS);
  assert.deepEqual(loop.properties.terminal_states.items.enum, LOOP_TERMINAL_STATES);
  assert.deepEqual(loop.properties.forbidden_harness_bypass.items.enum, LOOP_FORBIDDEN_HARNESS_BYPASS);
  assert.equal(loop.properties.resource_budget.additionalProperties, false, "resource budget must be closed");
  assert.deepEqual(
    loop.properties.resource_budget.required,
    ["time_limit_minutes", "token_limit", "retry_limit", "risk_limit"],
  );
}

function verifyControlPlaneContract(contract, schemaValue) {
  assert.ok(contract, "registry control_plane_contract required");
  validateSchemaFixture(contract, schemaValue.$defs.control_plane_contract, "control_plane_contract");
  assert.equal(contract.schema_ref, CONTROL_CONTRACT_SCHEMA_REF);
  assert.equal(contract.schema_version, "harness-loop-control.v1");
  assert.equal(contract.owner_task, "morrowise-dev-workflow-catalog");
  assert.deepEqual(contract.harness_mechanisms, HARNESS_MECHANISMS);
  assert.deepEqual(contract.harness_forbidden_policy_authority, HARNESS_FORBIDDEN_POLICY_AUTHORITY);
  assert.deepEqual(contract.loop_policy_required_fields, LOOP_POLICY_FIELDS);
  assert.deepEqual(contract.loop_terminal_states, LOOP_TERMINAL_STATES);
  assert.deepEqual(contract.loop_forbidden_harness_bypass, LOOP_FORBIDDEN_HARNESS_BYPASS);
  assert.deepEqual(contract.invariants, CONTROL_BOUNDARY_INVARIANTS);
  assert.deepEqual(contract.bindings, [
    {
      owner_task: "morrowise-live-decision-loop-v1",
      contract_ref: LOOP_POLICY_SCHEMA_REF,
      status: "planned",
    },
  ]);
  assert.ok(taskIds.has(contract.bindings[0].owner_task), "control contract binding owner_task must exist");
}

function verifyControlPlaneNegativeFixtures(schemaValue) {
  const harnessSchema = schemaValue.$defs.harness_contract;
  const loopSchema = schemaValue.$defs.loop_policy_contract;
  const validHarness = {
    role: "mechanism_provider",
    mechanisms: HARNESS_MECHANISMS,
    forbidden_policy_authority: HARNESS_FORBIDDEN_POLICY_AUTHORITY,
  };
  const validLoop = {
    role: "policy_controller",
    trigger: "fixture trigger",
    objective: "fixture objective",
    input_state: "fixture input",
    discovery_policy: "fixture discovery",
    prioritization_policy: "fixture priority",
    execution_roles: "fixture roles",
    context_policy: "fixture context",
    verification_policy: "fixture verification",
    retry_policy: "fixture retry",
    memory_writeback: "fixture memory",
    escalation_conditions: "fixture escalation",
    terminal_states: LOOP_TERMINAL_STATES,
    resource_budget: {
      time_limit_minutes: 60,
      token_limit: 1000,
      retry_limit: 1,
      risk_limit: "medium",
    },
    forbidden_harness_bypass: LOOP_FORBIDDEN_HARNESS_BYPASS,
  };

  assert.doesNotThrow(() => validateSchemaFixture(validHarness, harnessSchema, "harness fixture"));
  assert.doesNotThrow(() => validateSchemaFixture(validLoop, loopSchema, "loop fixture"));
  assert.throws(
    () => validateSchemaFixture({ ...validHarness, retry_decision: "harness decides" }, harnessSchema, "harness fixture"),
    /additional property retry_decision/,
  );
  assert.throws(
    () => validateSchemaFixture({ ...validHarness, terminal_state_decision: "DONE_VERIFIED" }, harnessSchema, "harness fixture"),
    /additional property terminal_state_decision/,
  );
  assert.throws(
    () => validateSchemaFixture({
      ...validLoop,
      forbidden_harness_bypass: [
        "sandbox_bypass",
        "sandbox_override",
        "tool_boundary_bypass",
        "context_boundary_bypass",
      ],
    }, loopSchema, "loop fixture"),
    /not in enum/,
  );
  for (const field of ["verification_policy", "retry_policy", "resource_budget", "escalation_conditions", "terminal_states"]) {
    const missing = structuredClone(validLoop);
    delete missing[field];
    assert.throws(
      () => validateSchemaFixture(missing, loopSchema, "loop fixture"),
      new RegExp(`missing required ${field}`),
    );
  }
}

function validateSchemaFixture(value, schemaNode, label) {
  assert.ok(schemaNode, `${label} schema missing`);
  if (schemaNode.type === "object") {
    assert.equal(typeof value, "object", `${label} must be object`);
    assert.equal(value === null || Array.isArray(value), false, `${label} must be object`);
    for (const field of schemaNode.required || []) {
      assert.ok(Object.hasOwn(value, field), `${label} missing required ${field}`);
    }
    if (schemaNode.additionalProperties === false) {
      for (const field of Object.keys(value)) {
        assert.ok(Object.hasOwn(schemaNode.properties || {}, field), `${label} additional property ${field}`);
      }
    }
    for (const [field, fieldValue] of Object.entries(value)) {
      const fieldSchema = schemaNode.properties?.[field];
      if (fieldSchema) validateSchemaFixture(fieldValue, fieldSchema, `${label}.${field}`);
    }
  } else if (schemaNode.type === "array") {
    assert.ok(Array.isArray(value), `${label} must be array`);
    if (schemaNode.minItems !== undefined) assert.ok(value.length >= schemaNode.minItems, `${label} below minItems`);
    if (schemaNode.uniqueItems) assert.equal(new Set(value).size, value.length, `${label} must contain unique items`);
    for (const [index, item] of value.entries()) validateSchemaFixture(item, schemaNode.items, `${label}[${index}]`);
  } else if (schemaNode.type === "string") {
    assert.equal(typeof value, "string", `${label} must be string`);
    if (schemaNode.minLength !== undefined) assert.ok(value.length >= schemaNode.minLength, `${label} below minLength`);
  } else if (schemaNode.type === "integer") {
    assert.equal(Number.isInteger(value), true, `${label} must be integer`);
    if (schemaNode.minimum !== undefined) assert.ok(value >= schemaNode.minimum, `${label} below minimum`);
  }
  if (schemaNode.const !== undefined) assert.deepEqual(value, schemaNode.const, `${label} does not match const`);
  if (schemaNode.enum) assert.ok(schemaNode.enum.includes(value), `${label} value ${value} not in enum`);
}

function verifyTaskLifecycleSchema(value) {
  assert.equal(value.$id, "https://hisenzi.local/schemas/morrowise-task-lifecycle.schema.json");
  assert.deepEqual(value.required, ["task_lifecycle"]);
  assert.equal(value.properties.weekly_core.type, "boolean");
  assert.match(value.properties.review_date.pattern, /0-9/);
  const lifecycle = value.properties.task_lifecycle;
  assert.deepEqual(lifecycle.required, ["route", "history"]);
  assert.equal(lifecycle.properties.route.const, "JV-32/task-lifecycle");
  assert.deepEqual(
    lifecycle.properties.history.items.properties.operation.enum,
    ["create", "amend", "suspend", "resume", "complete", "cancel", "archive"],
  );
  for (const field of ["operation", "from_status", "to_status", "reason", "evidence_refs", "recorded_at"]) {
    assert.ok(lifecycle.properties.history.items.required.includes(field), `task lifecycle schema missing ${field}`);
  }
  assert.deepEqual(value.$defs.semantic_intake.properties.outcome.enum, ["reuse", "amend", "replace", "genuinely_new"]);
  for (const field of ["problem", "owner_source_of_truth", "inputs_outputs", "lifecycle_completion"]) {
    assert.ok(value.$defs.semantic_intake.properties.scope_comparison.required.includes(field), `semantic intake schema missing ${field}`);
  }
  assert.deepEqual(value.$defs.weekly_core_review.properties.decision.enum, ["admit", "reframe", "suspend", "cancel", "complete"]);
  const weeklyCoreRule = value.allOf.find((rule) => rule.if?.properties?.weekly_core?.const === true);
  assert.ok(weeklyCoreRule, "task lifecycle schema must define a weekly_core=true rule");
  assert.ok(weeklyCoreRule.then.required.includes("status"), "weekly_core=true must require an explicit status field");
  assert.ok(weeklyCoreRule.then.required.includes("review_date"), "weekly_core=true must require review_date");
}

function verifyDocs(map, detail, lifecycle) {
  const lowerMap = map.toLowerCase();
  const lowerDetail = detail.toLowerCase();
  for (const text of [
    "$COLLAB/.tmp/skills-main/docs",
    "$COLLAB/.tmp/skills-main/skills",
    "intake evidence",
    "not source of truth",
    "link-skills.sh",
  ]) {
    assert.ok(lowerMap.includes(text.toLowerCase()), `source map missing ${text}`);
  }

  for (const text of [
    "workflow lifecycle",
    "router",
    "adapter_only",
    "close_rule",
    "ARCHITECTURE.md",
  ]) {
    assert.ok(lowerDetail.includes(text.toLowerCase()), `detail doc missing ${text}`);
  }
  assert.match(detail, /version improvement/i, "detail doc must define the architecture version-improvement review");
  assert.match(detail, /semantic intake/i, "detail doc must define semantic task intake");
  assert.match(detail, /weekly core/i, "detail doc must define the weekly core gate");
  assert.match(lifecycle, /Architecture Admission Review/, "task lifecycle doc must define the architecture admission review");
  assert.match(lifecycle, /Semantic Task Intake/, "task lifecycle doc must define semantic task intake");
  assert.match(lifecycle, /Weekly Core/, "task lifecycle doc must define weekly core review");

  for (const id of REQUIRED_WORKFLOW_IDS) {
    assert.ok(lowerMap.includes(id.toLowerCase()), `source map missing workflow id: ${id}`);
    assert.ok(lowerDetail.includes(id.toLowerCase()), `detail doc missing workflow id: ${id}`);
  }

  for (const id of ["setup-matt-pocock-skills", "git-guardrails-claude-code", "in-progress-skills", "deprecated-skills"]) {
    assert.ok(lowerMap.includes(id.toLowerCase()), `source map missing exclusion id: ${id}`);
  }
}

function verifyTaskLifecycleGovernance(commandMap, policy) {
  for (const text of ["task-lifecycle", "deferred", "cancelled", "archived", "closeout-commit-routing"]) {
    assert.ok(commandMap.includes(text), `task write command map missing ${text}`);
  }
  assert.equal(policy.task_lifecycle_contract?.route, "JV-32/task-lifecycle");
  const taskMutation = policy.policy_tiers
    ?.find((tier) => tier.policy === "approval_required")
    ?.rules?.find((rule) => rule.action_class === "task_state_mutation");
  assert.ok(taskMutation, "approval policy task_state_mutation rule missing");
  assert.ok(taskMutation.required_evidence.includes("JV-32 task-lifecycle route"));
  assert.ok(taskMutation.required_evidence.includes("append-only lifecycle history"));
  assert.ok(taskMutation.required_evidence.includes("semantic intake for MorroWise semantic task writes"));
  assert.ok(taskMutation.required_evidence.includes("weekly core admission or exit decision evidence when applicable"));
  assert.ok(taskMutation.required_evidence.includes("Architecture Admission Review when a promoted subsystem contract changes"));
  assert.match(policy.task_lifecycle_contract?.architecture_version_review || "", /Admission Record/);
  assert.match(policy.task_lifecycle_contract?.weekly_core_review || "", /automatic extension/i);
}

function verifyReadModel(value, sourceRegistry) {
  assert.equal(value.source, "$COLLAB/harness-mc/system-workflow/registries/morrowise-dev-workflow-catalog.json");
  assert.equal(value.generator, "$COLLAB/harness-mc/scripts/generate-morrowise-dev-workflows.mjs");
  assert.ok(value.generated_at, "read model generated_at required");
  assert.ok(value.write_boundary, "read model write_boundary required");
  assert.equal(value.verifier_ref, "node scripts/verify-morrowise-dev-workflow-catalog.mjs");
  assert.ok(Array.isArray(value.next_actions), "read model next_actions required");
  assert.equal(value.summary.total, sourceRegistry.workflows.length);
  assert.ok(value.summary.by_status.adapter_only >= 1, "read model must expose adapter_only count");

  const byId = new Map(value.workflows.map((workflow) => [workflow.id, workflow]));
  assert.equal(byId.size, sourceRegistry.workflows.length, "read model workflow count must mirror registry");
  for (const workflow of sourceRegistry.workflows) {
    const mirrored = byId.get(workflow.id);
    assert.ok(mirrored, `read model missing workflow: ${workflow.id}`);
    for (const field of ["id", "status", "close_rule", "owner_task", "writes_to", "external_effect", "verifier_ref"]) {
      assert.deepEqual(mirrored[field], workflow[field], `read model mismatch for ${workflow.id}.${field}`);
    }
  }
}

function verifyTaskState(value) {
  const task = value.find((item) => item.id === "morrowise-dev-workflow-catalog");
  assert.ok(task, "JV-32 task missing");
  assert.ok(["in_progress", "completed"].includes(task.status), "JV-32 task must be in_progress or completed");
  if (task.status === "completed") {
    assert.ok(task.completed_at, "completed JV-32 task requires completed_at");
    assert.ok(task.summary, "completed JV-32 task requires summary");
    assert.ok(Array.isArray(task.commits) && task.commits.length > 0, "completed JV-32 task requires commits");
  }
  assert.ok(task.architecture_decision, "JV-32 task architecture_decision required");
}

function verifyArchitectureAdmission(value) {
  const record = value.records.find((item) => item.id === "morrowise-dev-workflow-catalog");
  assert.ok(record, "architecture admission record missing");
  assert.ok(record.detail_doc, "detail_doc required");
  assert.equal(record.status, "active", "promoted architecture record must be active");
  assert.equal(String(record.role).includes("候選"), false, "promoted architecture role must not describe the subsystem as candidate");
  if (record.architecture_decision === "promoted") {
    assert.ok(record.detail_doc, "promoted architecture record requires detail_doc");
  }
  assert.equal(record.architecture_decision, "promoted");
  assert.equal(record.detail_doc, "$COLLAB/harness-mc/system-workflow/docs/specs/morrowise-dev-workflow-catalog.md");
  assert.deepEqual(record.source_of_truth, ARCHITECTURE_VERSION_REVIEW_REFS.slice(0, 3));
  assert.ok(record.verifiers.includes("node scripts/verify-morrowise-dev-workflow-catalog.mjs"));

  const review = record.version_review;
  assert.ok(review && typeof review === "object" && !Array.isArray(review), "JV-32 admission record requires version_review");
  assert.equal(review.scope, "version_improvement");
  assert.match(review.reviewed_at, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(review.contract_refs, ARCHITECTURE_VERSION_REVIEW_REFS);
  assert.equal(review.contract_fingerprint, architectureContractFingerprint(review.contract_refs), "version_review.contract_fingerprint is stale");
  assert.ok(["updated", "no_index_change"].includes(review.index_action), "version_review.index_action must record index decision");
  assert.equal(review.sync_check_ref, "python3 \"$COLLAB/notyet-harness/000_Agent/scripts/sync-architecture-subsystems.py\" --check");
  assert.ok(review.evidence_refs?.includes("node scripts/verify-morrowise-dev-workflow-catalog.mjs"));
  assert.ok(review.reason, "version_review requires a reason");
}

function verifyWiringFixture(value) {
  const fixture = value.fixtures.find((item) => item.id === "morrowise-dev-workflows-read-model");
  assert.ok(fixture, "read_model_surface_only wiring fixture missing");
  assert.equal(fixture.fixture_scope, "read_model_surface_only");
  assert.equal(fixture.homepage_anchor, null);
  assert.equal(fixture.owner_task, "morrowise-dev-workflow-catalog");
  assert.equal(fixture.source_registry, "$COLLAB/harness-mc/system-workflow/registries/morrowise-dev-workflow-catalog.json");
  assert.equal(fixture.generated_read_model, "$COLLAB/harness-mc/public/data/morrowise-dev-workflows.json");
  assert.ok(fixture.verifier_refs.includes("node scripts/verify-morrowise-dev-workflow-catalog.mjs"));
}

function verifyNegativeFixtures(value) {
  const first = structuredClone(value.workflows[0]);
  assert.throws(() => validateWorkflow({ ...first, close_rule: "" }), /close_rule required/);
  assert.throws(() => validateWorkflow({ ...first, writes_to: "github_issues", status: "accepted" }), /external issue tracker writes must be adapter_only/);
  assert.throws(() => validateWorkflow({ ...first, writes_to: "GitHub Issues", status: "accepted" }), /external issue tracker writes must be adapter_only/);
  assert.throws(() => validateWorkflow({ ...first, writes_to: "external tracker", status: "accepted" }), /external issue tracker writes must be adapter_only/);
  assert.throws(() => validateWorkflow({ ...first, external_effect: "install" }), /external_effect cannot be install/);
  assert.throws(() => validateWorkflow({ ...first, external_effect: "hooks_modify" }), /hooks_modify/);
  assert.throws(() => validateWorkflow({ ...first, source_doc: "$COLLAB/notyet-harness/secrets/token.txt" }), /forbidden source\/auth ref/);
  assert.throws(() => validateWorkflow({ ...first, owner_task: "missing-task" }), /owner_task must exist/);

  const architectureWithoutDetail = {
    records: [
      {
        id: "morrowise-dev-workflow-catalog",
        architecture_decision: "promoted",
        source_of_truth: ["$COLLAB/harness-mc/system-workflow/registries/morrowise-dev-workflow-catalog.json"],
        detail_doc: "",
        verifiers: ["node scripts/verify-morrowise-dev-workflow-catalog.mjs"],
      },
    ],
  };
  assert.throws(() => verifyArchitectureAdmission(architectureWithoutDetail), /detail_doc/);

  const staleArchitectureReview = structuredClone(architectureRegistry);
  staleArchitectureReview.records.find((item) => item.id === "morrowise-dev-workflow-catalog").version_review = {
    scope: "version_improvement",
    reviewed_at: "2026-07-18",
    contract_refs: ARCHITECTURE_VERSION_REVIEW_REFS,
    contract_fingerprint: "stale-review-fingerprint",
    index_action: "no_index_change",
    sync_check_ref: "python3 \"$COLLAB/notyet-harness/000_Agent/scripts/sync-architecture-subsystems.py\" --check",
    evidence_refs: ["node scripts/verify-morrowise-dev-workflow-catalog.mjs"],
    reason: "Fixture proves stale version review cannot pass.",
  };
  assert.throws(() => verifyArchitectureAdmission(staleArchitectureReview), /contract_fingerprint/);
}

function verifyArchitectureFingerprintBoundary() {
  const baseline = architectureContractFingerprint(ARCHITECTURE_VERSION_REVIEW_REFS);
  const unrelatedPackageChange = structuredClone(packageJson);
  unrelatedPackageChange.scripts["test:jv32-unrelated-fingerprint-fixture"] = "node -e \"process.exit(0)\"";
  assert.equal(
    architectureContractFingerprint(ARCHITECTURE_VERSION_REVIEW_REFS, { packageManifest: unrelatedPackageChange }),
    baseline,
    "unrelated package.json scripts must not change the JV-32 architecture contract fingerprint",
  );

  const requiredPrebuildChange = structuredClone(packageJson);
  requiredPrebuildChange.scripts.prebuild = String(requiredPrebuildChange.scripts.prebuild || "")
    .replace(catalogVerifier, "node scripts/verify-jv32-prebuild-fixture.mjs");
  assert.notEqual(
    architectureContractFingerprint(ARCHITECTURE_VERSION_REVIEW_REFS, { packageManifest: requiredPrebuildChange }),
    baseline,
    "changing a required JV-32 prebuild command must change the architecture contract fingerprint",
  );
}

function architectureContractFingerprint(refs, { packageManifest = packageJson } = {}) {
  const source = refs.map((ref) => {
    return `${ref}\n${architectureContractSource(ref, { packageManifest })}`;
  }).join("\n---\n");
  return crypto.createHash("sha256").update(source).digest("hex").slice(0, 16);
}

function architectureContractSource(ref, { packageManifest }) {
  if (ref === JV32_PREBUILD_CONTRACT_REF) {
    const commands = String(packageManifest?.scripts?.prebuild || "")
      .split("&&")
      .map((command) => command.trim())
      .filter((command) => JV32_PREBUILD_COMMANDS.includes(command));
    return JSON.stringify({ contract: "jv32-prebuild-contract-v1", commands });
  }
  return fs.readFileSync(resolveCollabRef(ref), "utf8");
}

function assertSafeRef(recordId, ref) {
  const [fileRef] = ref.replace(/^\$COLLAB\//, "").split("#");
  assert.equal(
    fileRef.split(/[\\/]/).includes(".."),
    false,
    `${recordId} contains path traversal: ${ref}`,
  );
  for (const pattern of FORBIDDEN_REF_PATTERNS) {
    assert.equal(pattern.test(ref), false, `${recordId} contains forbidden source/auth ref: ${ref}`);
  }
}

function assertWorkflowSourceRef(recordId, ref) {
  assert.match(ref, /^\$COLLAB\//, `${recordId} ref must use $COLLAB: ${ref}`);
  if (!isHarnessOwnedRef(ref)) return;
  const filePath = resolveCollabRef(ref);
  assert.equal(fs.existsSync(filePath), true, `${recordId} ref does not resolve: ${ref}`);
}

function isHarnessOwnedRef(ref) {
  const relativePath = path.relative(root, resolveCollabRef(ref));
  return relativePath === "" || (
    relativePath !== ".."
    && !relativePath.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relativePath)
  );
}

function resolveCollabRef(ref) {
  const [fileRef] = ref.replace(/^\$COLLAB\//, "").split("#");
  if (fileRef === "harness-mc") return root;
  if (fileRef.startsWith("harness-mc/")) return path.join(root, fileRef.slice("harness-mc/".length));
  return path.join(collabRoot, fileRef);
}

function hasExternalTrackerWrite(value) {
  return EXTERNAL_TRACKER_WRITE_PATTERN.test(String(value));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
