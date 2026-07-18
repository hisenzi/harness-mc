import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const collabRoot = path.resolve(root, "..");
const notyetRoot = process.env.MORROWISE_NOTYET_ROOT
  ? path.resolve(process.env.MORROWISE_NOTYET_ROOT)
  : path.join(collabRoot, "notyet-harness");

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
  "$COLLAB/harness-mc/scripts/generate-morrowise-dev-workflows.mjs",
  "$COLLAB/harness-mc/scripts/verify-morrowise-dev-workflow-catalog.mjs",
];

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
const packageJson = readJson(packageJsonPath);
const sourceMap = fs.readFileSync(sourceMapPath, "utf8");
const detailDoc = fs.readFileSync(detailDocPath, "utf8");
const taskLifecycleDoc = fs.readFileSync(taskLifecycleDocPath, "utf8");
const taskWriteMap = fs.readFileSync(taskWriteMapPath, "utf8");
const approvalPolicy = readJson(approvalPolicyPath);
const taskIds = new Set(tasks.map((task) => task.id));

verifyRegistry(registry);
verifySchema(schema);
verifyTaskLifecycleSchema(taskLifecycleSchema);
verifyDocs(sourceMap, detailDoc, taskLifecycleDoc);
verifyTaskLifecycleGovernance(taskWriteMap, approvalPolicy);
verifyReadModel(readModel, registry);
verifyTaskState(tasks);
verifyArchitectureAdmission(architectureRegistry);
verifyWiringFixture(wiringGate);
verifyNegativeFixtures(registry);

console.log("MorroWise dev workflow catalog verification OK");

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
    assertResolvableRef(workflow.id, ref);
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

function verifyTaskLifecycleSchema(value) {
  assert.equal(value.$id, "https://hisenzi.local/schemas/morrowise-task-lifecycle.schema.json");
  assert.deepEqual(value.required, ["route", "history"]);
  assert.equal(value.properties.route.const, "JV-32/task-lifecycle");
  assert.deepEqual(
    value.properties.history.items.properties.operation.enum,
    ["create", "amend", "suspend", "resume", "complete", "cancel", "archive"],
  );
  for (const field of ["operation", "from_status", "to_status", "reason", "evidence_refs", "recorded_at"]) {
    assert.ok(value.properties.history.items.required.includes(field), `task lifecycle schema missing ${field}`);
  }
  const relationshipImpact = value.properties.history.items.properties.architecture_relation_impact;
  assert.ok(relationshipImpact, "task lifecycle schema missing architecture_relation_impact");
  assert.deepEqual(relationshipImpact.properties.decision.enum, ["none", "add", "update", "retire"]);
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
  assert.match(lifecycle, /Architecture Admission Review/, "task lifecycle doc must define the architecture admission review");

  for (const id of REQUIRED_WORKFLOW_IDS) {
    assert.ok(lowerMap.includes(id.toLowerCase()), `source map missing workflow id: ${id}`);
    assert.ok(lowerDetail.includes(id.toLowerCase()), `detail doc missing workflow id: ${id}`);
  }

  for (const id of ["setup-matt-pocock-skills", "git-guardrails-claude-code", "in-progress-skills", "deprecated-skills"]) {
    assert.ok(lowerMap.includes(id.toLowerCase()), `source map missing exclusion id: ${id}`);
  }
}

function verifyTaskLifecycleGovernance(commandMap, policy) {
  for (const text of ["task-lifecycle", "deferred", "cancelled", "archived", "closeout-commit-routing", "architecture_relation_impact"]) {
    assert.ok(commandMap.includes(text), `task write command map missing ${text}`);
  }
  assert.equal(policy.task_lifecycle_contract?.route, "JV-32/task-lifecycle");
  const taskMutation = policy.policy_tiers
    ?.find((tier) => tier.policy === "approval_required")
    ?.rules?.find((rule) => rule.action_class === "task_state_mutation");
  assert.ok(taskMutation, "approval policy task_state_mutation rule missing");
  assert.ok(taskMutation.required_evidence.includes("JV-32 task-lifecycle route"));
  assert.ok(taskMutation.required_evidence.includes("append-only lifecycle history"));
  assert.ok(taskMutation.required_evidence.includes("Architecture Admission Review when a promoted subsystem contract changes"));
  assert.match(policy.task_lifecycle_contract?.architecture_version_review || "", /Admission Record/);
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

function architectureContractFingerprint(refs) {
  const source = refs.map((ref) => {
    const [fileRef] = ref.replace(/^\$COLLAB\//, "").split("#");
    return `${ref}\n${fs.readFileSync(resolveCollabRef(fileRef), "utf8")}`;
  }).join("\n---\n");
  return crypto.createHash("sha256").update(source).digest("hex").slice(0, 16);
}

function assertSafeRef(recordId, ref) {
  for (const pattern of FORBIDDEN_REF_PATTERNS) {
    assert.equal(pattern.test(ref), false, `${recordId} contains forbidden source/auth ref: ${ref}`);
  }
}

function assertResolvableRef(recordId, ref) {
  assert.match(ref, /^\$COLLAB\//, `${recordId} ref must use $COLLAB: ${ref}`);
  const [fileRef] = ref.replace(/^\$COLLAB\//, "").split("#");
  const filePath = resolveCollabRef(fileRef);
  assert.equal(fs.existsSync(filePath), true, `${recordId} ref does not resolve: ${ref}`);
}

function resolveCollabRef(fileRef) {
  if (fileRef === "harness-mc" || fileRef.startsWith("harness-mc/")) {
    return path.join(root, fileRef.replace(/^harness-mc\/?/, ""));
  }
  if (fileRef === "notyet-harness" || fileRef.startsWith("notyet-harness/")) {
    return path.join(notyetRoot, fileRef.replace(/^notyet-harness\/?/, ""));
  }
  return path.join(collabRoot, fileRef);
}

function hasExternalTrackerWrite(value) {
  return EXTERNAL_TRACKER_WRITE_PATTERN.test(String(value));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
