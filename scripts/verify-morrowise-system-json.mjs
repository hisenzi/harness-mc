import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateMorroWiseSystem } from "./generate-morrowise-system.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const collabRoot = path.resolve(root, "..");
const dataPath = path.join(root, "public", "data", "morrowise-system.json");
const schemaPath = path.join(root, "system-workflow", "schemas", "morrowise-system.schema.json");

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

const requiredOpenLoopFields = [
  "loop_id",
  "gate_id",
  "source",
  "condition",
  "risk_level",
  "suggested_next_action",
  "requires_approval",
  "owner",
  "review_after",
  "evidence_refs",
];

const sourceRefFields = ["source_of_truth", "portable_agent_verification", "memory", "senses", "muscles", "immune", "heartbeat", "feedback", "open_loops"];

const fixtureOptions = {
  generatedAt: "2026-06-27T12:00:00.000Z",
  auditorReport: null,
  morrowiseProject: {
    tasks: [
      { id: "v0-source-map-mc-reconcile", status: "completed" },
      { id: "auditor-json-read-model-schema", status: "completed" },
      { id: "live-system-admission-gate", status: "completed" },
      { id: "morrowise-system-json-generator-v0", status: "todo", dependencies: ["v0-source-map-mc-reconcile", "auditor-json-read-model-schema", "live-system-admission-gate"] },
    ],
  },
  projects: null,
  taskEvents: {
    task_events: { pending: 2, applied: 0, rejected: 0 },
    recent_task_events: [
      {
        id: "task.commit_attached-example",
        queue: "pending",
        type: "task.commit_attached",
        file: "example.json",
      },
    ],
  },
  worktrees: { repositories: [] },
  liveDashboard: {
    surfaces: [
      {
        id: "system_attention",
        freshness_state: "stale",
        freshness_reason: "fixture stale surface",
        next_action: { target: "npm run prebuild" },
      },
    ],
  },
  capabilities: {
    capabilities: [
      { id: "playwright-cli", type: "cli", status: "unknown" },
    ],
  },
  residualLedger: { summary: { residual_count: 3 }, repositories: [] },
  proactiveLoop: {
    runner: {
      outputs: [
        {
          recommendation_id: "fixture.approval",
          action_class: "external_sync_or_write",
          policy: "approval_required",
          risk_level: "high",
          output_type: "approval_request",
        },
      ],
    },
    scenarios: [
      {
        scenario_id: "fixture",
        trigger: { trigger_id: "morrowise.weekly_review", risk_level: "low" },
        recommendation: {
          recommendation_id: "fixture.recommendation",
          reason: "fixture",
          suggested_action: "review",
          suggested_task_id: "morrowise-system-json-generator-v0",
          evidence_refs: [{ type: "task", ref: "$COLLAB/harness-mc/milestones/morrowise/tasks.json#morrowise-system-json-generator-v0" }],
          hc_refs: ["#systemDynamics"],
          hc_reasoning: "fixture",
          hc_confidence: 0.7,
        },
        approval: { requires_approval: false, risk_level: "low" },
      },
    ],
  },
  admission: {
    components: [
      {
        component_id: "fixture-component",
        trigger: ["manual"],
        source_of_truth: ["$COLLAB/harness-mc/milestones/morrowise/tasks.json"],
        process: ["fixture"],
        output: ["fixture-output"],
        surface: ["fixture-surface"],
        verifier: ["npm run test:morrowise-system-json"],
        admission_state: "accepted",
      },
    ],
  },
  approval: {
    status: "formal_policy",
    core_rules: {
      secret_boundary: "Do not read secrets.",
      external_effect_rule: "External writes require approval.",
      commit_boundary_rule: "Commits require worktree-commit.",
    },
    policy_tiers: [
      {
        policy: "allowed",
        rules: [{ action_class: "generate_local_read_model", reason: "fixture", conditions: ["local only"] }],
      },
      {
        policy: "approval_required",
        rules: [{ action_class: "commit_push_deploy", reason: "fixture", required_evidence: ["diff"] }],
      },
    ],
  },
  triggers: {
    triggers: [
      {
        trigger_id: "morrowise.weekly_review",
        condition: "fixture trigger",
        cooldown: "24h",
        output_event: { target: "morrowise-recommendation-engine-v0" },
      },
    ],
  },
  capabilityRegistry: { capabilities: [] },
  wiringGate: { status: "formal_registry" },
  commitPlanningGate: { status: "formal_registry" },
  write: false,
};
const fixture = generateMorroWiseSystem(fixtureOptions);

validateSystemReadModel(fixture, { fixture: true });

// Auditor loops are conditional on the auditor read model: present with findings →
// resolved loops close and an auditor-findings loop opens instead.
const fixtureResolved = generateMorroWiseSystem({
  ...fixtureOptions,
  auditorReport: { summary: { finding_count: 8, primary_next_action: "morrowise/architecture-pulse-source-edit" } },
});
assert.ok(!fixtureResolved.open_loops.some((loop) => loop.loop_id === "generator-missing-auditor-json"), "auditor read model present: generator-missing loop must close");
assert.ok(!fixtureResolved.open_loops.some((loop) => loop.loop_id === "manual-only-architecture-pulse"), "auditor read model present: manual-only loop must close");
assert.ok(fixtureResolved.open_loops.some((loop) => loop.loop_id === "auditor-findings-open"), "open auditor findings must surface as a loop");

assert.ok(fs.existsSync(dataPath), "public/data/morrowise-system.json must exist; run node scripts/generate-morrowise-system.mjs");
const data = readJson(dataPath);
validateSystemReadModel(data, { fixture: false });

const schema = readJson(schemaPath);
for (const key of requiredTopLevel) {
  assert.ok(schema.required.includes(key), `schema required fields missing ${key}`);
}

console.log("MorroWise system read model verification OK");

function validateSystemReadModel(data, { fixture }) {
  for (const key of requiredTopLevel) {
    assert.ok(Object.hasOwn(data, key), `morrowise-system missing ${key}`);
  }

  assert.equal(data.schema_version, "morrowise-system.v0");
  assert.equal(data.source_of_truth.collab_root, "$COLLAB");
  assert.ok(data.source_of_truth.canonical_task_state.includes("$COLLAB/harness-mc/milestones/morrowise/tasks.json"));
  assert.ok(data.source_of_truth.generated_data.includes("$COLLAB/harness-mc/public/data/morrowise-system.json"));
  assert.equal(data.source_of_truth.docs_are, "routing_and_decision_evidence");

  for (const layer of data.source_of_truth.visual_layers) {
    assert.equal(layer.may_close_task, false, `${layer.name}: visual layer may not close task`);
    assert.ok(["mirror", "read_model", "dashboard", "external_surface"].includes(layer.role), `${layer.name}: invalid visual role`);
  }

  assert.equal(data.portable_agent_verification.principle, "Data belongs to Vincent; AI agents are replaceable executors.");
  assert.equal(data.portable_agent_verification.work_anchor_required, true);
  assert.ok(data.portable_agent_verification.entry_chain.every((item) => item.startsWith("$COLLAB/")), "entry_chain must use $COLLAB paths");
  assert.ok(data.portable_agent_verification.required_checks.some((check) => check.command.includes("work-anchor-preflight")), "work-anchor preflight check required");

  assert.equal(data.dna.system_name, "MorroWise");
  assert.ok(data.dna.non_goals.some((item) => item.includes("secrets")), "DNA must keep secret boundary visible");

  assert.ok(Array.isArray(data.memory.context) && data.memory.context.length >= 1, "memory.context required");
  assert.ok(Array.isArray(data.memory.commit_boundaries), "memory.commit_boundaries required");
  assert.ok(Array.isArray(data.senses.triggers) && data.senses.triggers.length >= 1, "senses.triggers required");
  assert.ok(Object.hasOwn(data.senses.freshness, "degraded"), "senses.freshness.degraded required");
  assert.ok(Array.isArray(data.muscles.tools), "muscles.tools required");
  assert.ok(Array.isArray(data.muscles.actions), "muscles.actions required");
  assert.ok(data.immune.validators.some((check) => check.command.includes("test:morrowise-system-json")), "immune validators must include system verifier");
  assert.ok(data.immune.security_boundaries.some((item) => item.toLowerCase().includes("secret")), "immune security boundaries must mention secrets");
  assert.ok(data.heartbeat.stale_rules.length >= 1, "heartbeat.stale_rules required");
  assert.ok(data.feedback.gates.length >= 1, "feedback.gates required");

  assert.ok(data.open_loops.length >= 1, "open_loops should expose unresolved work");
  for (const loop of data.open_loops) {
    for (const key of requiredOpenLoopFields) {
      assert.ok(Object.hasOwn(loop, key), `${loop.loop_id || "open_loop"} missing ${key}`);
    }
    assert.ok(loop.suggested_next_action.trim().length > 0, `${loop.loop_id}: next action required`);
    assert.ok(loop.evidence_refs.length > 0, `${loop.loop_id}: evidence refs required`);
  }

  if (fixture) {
    assert.ok(
      data.open_loops.some((loop) => loop.loop_id.includes("pending-task-events") || loop.condition.includes("pending")),
      "open_loops must expose pending events or an equivalent unresolved event condition",
    );
  }
  // generator_missing / manual_only are conditional on the auditor read model existing;
  // requiring them unconditionally would freeze a resolvable state into the verifier.
  const auditorPending = fixture ? true : !fs.existsSync(path.join(root, "public", "data", "morrowise-auditor.json"));
  const expectedConditions = ["unknown", "second_source_risk", "stale", ...(auditorPending ? ["generator_missing", "manual_only"] : [])];
  for (const expectedCondition of expectedConditions) {
    assert.ok(
      data.open_loops.some((loop) => loop.condition.includes(expectedCondition) || loop.loop_id.includes(expectedCondition.replace(/_/g, "-"))),
      `open_loops must expose ${expectedCondition}`,
    );
  }
  if (!fixture && !auditorPending) {
    assert.ok(!data.open_loops.some((loop) => loop.loop_id === "generator-missing-auditor-json"), "resolved generator-missing loop must not be reported");
    assert.ok(!data.open_loops.some((loop) => loop.loop_id === "manual-only-architecture-pulse"), "resolved manual-only loop must not be reported");
  }

  assertNoLocalAbsolutePaths(data);
  assertSourceRefs(data, { fixture });
}

function assertNoLocalAbsolutePaths(value) {
  const text = JSON.stringify(value);
  assert.equal(/\/Users\/[A-Za-z]+\//.test(text), false, "read model must not contain hardcoded /Users paths");
  assert.equal(/~\/Downloads\/Claude_/.test(text), false, "read model must not contain ~/Downloads collaboration paths");
}

function assertSourceRefs(value, { fixture }) {
  const refs = [];
  collectSourceRefs(value, refs);

  for (const ref of refs) {
    if (!ref.startsWith("$COLLAB/")) continue;
    if (fixture && ref.includes("example.json")) continue;
    if (ref.includes("*")) continue;
    const [fileRef] = ref.split("#");
    const abs = path.join(collabRoot, fileRef.replace(/^\$COLLAB\//, ""));
    assert.ok(fs.existsSync(abs), `source ref missing: ${fileRef}`);
  }
}

function collectSourceRefs(value, out) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectSourceRefs(item, out);
    return;
  }
  if (typeof value.ref === "string") out.push(value.ref);
  for (const field of sourceRefFields) {
    if (value[field]) collectSourceRefs(value[field], out);
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
