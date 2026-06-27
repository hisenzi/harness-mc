import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const schemaPath = path.join(root, "system-workflow", "schemas", "morrowise-auditor.schema.json");
const specPath = path.join(root, "..", "notyet-harness", "000_Agent", "docs", "morrowise", "auditor-mvp.md");
const tasksPath = path.join(root, "milestones", "morrowise", "tasks.json");

const schema = readJson(schemaPath);
const auditorSpec = fs.readFileSync(specPath, "utf8");
const taskIds = new Set(readJson(tasksPath).tasks.map((task) => task.id));

const requiredTopLevel = [
  "schema_version",
  "generated_at",
  "read_only",
  "targets",
  "summary",
  "findings",
  "next_actions",
  "write_boundary",
];

const requiredFindingFields = [
  "id",
  "target_id",
  "source_family",
  "severity",
  "category",
  "evidence_ref",
  "declared_state",
  "observed_state",
  "why_it_matters",
  "suggested_action",
];

const requiredForbiddenActions = [
  "edit_source",
  "close_task",
  "commit",
  "push",
  "external_sync",
];

const requiredFixtureCategories = [
  "missing_header",
  "source_missing",
  "stale_warning",
  "fake_live_risk",
];

assert.equal(schema.$id, "morrowise-auditor.schema.json");
assert.equal(schema.properties?.schema_version?.const, "morrowise-auditor.v0");
assert.equal(schema.properties?.read_only?.const, true);

for (const key of requiredTopLevel) {
  assert.ok(schema.required.includes(key), `schema.required missing ${key}`);
  assert.ok(schema.properties[key], `schema.properties missing ${key}`);
}

const defs = schema.$defs || {};
for (const key of ["target", "summary", "finding", "nextAction", "writeBoundary", "check", "section"]) {
  assert.ok(defs[key], `schema.$defs missing ${key}`);
}

for (const key of requiredFindingFields) {
  assert.ok(defs.finding.required.includes(key), `finding required fields missing ${key}`);
}

const findingCategories = new Set(defs.finding.properties.category.enum);
for (const category of [
  "missing_header",
  "missing_source_of_truth",
  "source_missing",
  "stale_warning",
  "stale_error",
  "missing_verifier",
  "generated_manual_conflict",
  "path_policy_violation",
  "fake_live_risk",
]) {
  assert.ok(findingCategories.has(category), `finding category missing ${category}`);
}

const forbiddenSchema = defs.writeBoundary.properties.forbidden;
for (const action of requiredForbiddenActions) {
  assert.ok(forbiddenSchema.items.enum.includes(action), `write_boundary.forbidden enum missing ${action}`);
  assert.ok(
    forbiddenSchema.allOf.some((rule) => rule.contains?.const === action),
    `write_boundary.forbidden does not require ${action}`,
  );
}

assert.ok(auditorSpec.includes("JSON candidate"), "auditor spec missing JSON candidate");
assert.ok(auditorSpec.includes("Finding Contract"), "auditor spec missing finding contract");
assert.ok(auditorSpec.includes("no autonomous edits"), "auditor spec missing read-only boundary");

const fixture = buildAuditorFixture();
validateFixtureReadModel(fixture);

const fixtureCategories = new Set(fixture.findings.map((finding) => finding.category));
for (const category of requiredFixtureCategories) {
  assert.ok(fixtureCategories.has(category), `fixture missing ${category}`);
}

console.log("MorroWise auditor schema verification OK");

function buildAuditorFixture() {
  return {
    schema_version: "morrowise-auditor.v0",
    generated_at: "2026-06-27T20:30:00+08:00",
    read_only: true,
    targets: [
      {
        target_id: "architecture_docs.ARCHITECTURE",
        target_path: "$COLLAB/notyet-harness/000_Agent/ARCHITECTURE.md",
        source_family: "architecture_docs",
        expected_identity: "canonical",
        classification: "semi_live",
        checks: [
          { id: "header-contract", kind: "header", result: "fail" },
          { id: "missing-source-fixture", kind: "source_existence", result: "missing" },
          { id: "freshness", kind: "freshness", result: "warning" },
          { id: "live-surface", kind: "live_surface", result: "warning" },
        ],
        sections: [
          {
            id: "header",
            line_ref: "$COLLAB/notyet-harness/000_Agent/ARCHITECTURE.md:1-4",
            classification: "unknown",
            reason: "Missing managed document contract fields.",
          },
        ],
        verifier_ref: "npm run test:morrowise-auditor",
        write_boundary: readOnlyBoundary(),
      },
    ],
    summary: {
      target_count: 1,
      finding_count: 4,
      blocking_count: 0,
      error_count: 2,
      warning_count: 2,
      missing_verifier_count: 0,
      stale_count: 1,
      fake_live_risk_count: 1,
      path_policy_risk_count: 0,
      primary_next_action: "morrowise/morrowise-system-json-generator-v0",
    },
    findings: [
      finding({
        id: "FIXTURE-01",
        severity: "error",
        category: "missing_header",
        evidence_ref: "$COLLAB/notyet-harness/000_Agent/ARCHITECTURE.md:1-4",
        declared_state: "Document has a title and last updated line.",
        observed_state: "Folder contract fields are missing.",
      }),
      finding({
        id: "FIXTURE-02",
        severity: "error",
        category: "source_missing",
        evidence_ref: "$COLLAB/notyet-harness/000_Agent/docs/morrowise/missing-source-fixture.md",
        declared_state: "Target profile points to a managed source.",
        observed_state: "The source cannot be resolved.",
      }),
      finding({
        id: "FIXTURE-03",
        severity: "warning",
        category: "stale_warning",
        evidence_ref: "$COLLAB/notyet-harness/000_Agent/ARCHITECTURE.md:3",
        declared_state: "Last updated 2026-04-06.",
        observed_state: "Newer MorroWise specs exist and the document is stale.",
      }),
      finding({
        id: "FIXTURE-04",
        severity: "warning",
        category: "fake_live_risk",
        evidence_ref: "$COLLAB/notyet-harness/000_Agent/ARCHITECTURE.md:84-163",
        declared_state: "Schedule table looks operational.",
        observed_state: "No generated_at, stale rule, next action, or verifier is attached.",
      }),
    ],
    next_actions: [
      {
        id: "NA-01",
        priority: 1,
        action: "Feed auditor output into the MorroWise system read model generator.",
        owner_task: "morrowise-system-json-generator-v0",
        source_finding_ids: ["FIXTURE-01", "FIXTURE-03", "FIXTURE-04"],
        status: "ready",
      },
    ],
    write_boundary: readOnlyBoundary(),
  };
}

function finding(input) {
  return {
    target_id: "architecture_docs.ARCHITECTURE",
    source_family: "architecture_docs",
    why_it_matters: "Future agents need repeatable evidence instead of static architectural claims.",
    suggested_action: "Route through a task-backed source edit or generator task; do not let the auditor edit sources.",
    ...input,
  };
}

function readOnlyBoundary() {
  return {
    allowed: ["report", "recommend", "draft_task"],
    forbidden: ["edit_source", "close_task", "commit", "push", "external_sync"],
  };
}

function validateFixtureReadModel(model) {
  assert.equal(model.schema_version, "morrowise-auditor.v0");
  assert.equal(model.read_only, true);
  assertRequiredKeys(model, requiredTopLevel, "fixture");
  assertReadOnlyBoundary(model.write_boundary, "fixture.write_boundary");
  assert.equal(model.summary.finding_count, model.findings.length, "summary finding_count must match findings length");
  assert.equal(model.summary.target_count, model.targets.length, "summary target_count must match targets length");

  const targetIds = new Set(model.targets.map((target) => target.target_id));
  for (const target of model.targets) {
    assert.match(target.target_path, /^\$COLLAB\//, `${target.target_id}: target_path must use $COLLAB`);
    assertReadOnlyBoundary(target.write_boundary, `${target.target_id}.write_boundary`);
  }

  for (const findingItem of model.findings) {
    assertRequiredKeys(findingItem, requiredFindingFields, findingItem.id || "finding");
    assert.ok(targetIds.has(findingItem.target_id), `${findingItem.id}: target_id must match a target`);
    assert.ok(findingCategories.has(findingItem.category), `${findingItem.id}: unknown category ${findingItem.category}`);
    assert.match(findingItem.evidence_ref, /^\$COLLAB\/|^task:|^schema:|^command:|^manual:/, `${findingItem.id}: evidence_ref must be traceable`);
  }

  for (const action of model.next_actions) {
    assert.ok(taskIds.has(action.owner_task), `${action.id}: owner_task must exist in morrowise tasks`);
  }
}

function assertReadOnlyBoundary(boundary, label) {
  assert.deepEqual(boundary.allowed, ["report", "recommend", "draft_task"], `${label}: allowed actions mismatch`);
  for (const action of requiredForbiddenActions) {
    assert.ok(boundary.forbidden.includes(action), `${label}: missing forbidden action ${action}`);
  }
}

function assertRequiredKeys(value, keys, label) {
  for (const key of keys) {
    assert.ok(Object.hasOwn(value, key), `${label} missing ${key}`);
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
