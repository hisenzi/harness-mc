import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateAuditorReport, ARCHITECTURE_PULSE_PROFILE } from "./generate-morrowise-auditor.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const fixtureDir = "$COLLAB/harness-mc/scripts/fixtures/morrowise-auditor";
const taskIds = new Set(JSON.parse(fs.readFileSync(path.join(root, "milestones", "morrowise", "tasks.json"), "utf8")).tasks.map((task) => task.id));

const REQUIRED_TOP_LEVEL = ["schema_version", "generated_at", "read_only", "targets", "summary", "findings", "next_actions", "write_boundary"];
const REQUIRED_FINDING_FIELDS = ["id", "target_id", "source_family", "severity", "category", "evidence_ref", "declared_state", "observed_state", "why_it_matters", "suggested_action"];
const CATEGORY_ENUM = new Set([
  "missing_header", "missing_source_of_truth", "source_missing", "source_conflict",
  "stale_warning", "stale_error", "missing_verifier", "generated_manual_conflict",
  "mirror_as_canonical", "historical_used_as_active", "path_policy_violation", "fake_live_risk",
]);

function fixtureProfile(id, file, overrides = {}) {
  return {
    ...ARCHITECTURE_PULSE_PROFILE,
    target_id: `architecture_docs.fixture-${id}`,
    target_path: `${fixtureDir}/${file}`,
    fake_live_rules: [{ id: "schedule-tables", heading_pattern: /排程/ }],
    verifier_required_rules: [],
    historical_markers: null,
    ...overrides,
  };
}

// 1. Fixture runs: strict category assertions — fixtures are synthetic, so exact
//    expectations here never rot with live task or document lifecycle.
const FIXTURES = [
  { id: "missing-header", file: "missing-header.md", expect: ["missing_header"] },
  { id: "stale-source", file: "stale-source.md", expect: ["stale_warning", "source_missing"] },
  { id: "hardcoded-local-path", file: "hardcoded-local-path.md", expect: ["path_policy_violation"] },
  { id: "generated-manual-conflict", file: "generated-manual-conflict.md", expect: ["generated_manual_conflict"] },
  { id: "fake-live-schedule", file: "fake-live-schedule.md", expect: ["fake_live_risk"] },
];

for (const fixture of FIXTURES) {
  const report = generateAuditorReport({
    profiles: [fixtureProfile(fixture.id, fixture.file)],
    write: false,
    now: "2026-07-03T00:00:00+08:00",
  });
  const categories = report.findings.map((finding) => finding.category);
  for (const expected of fixture.expect) {
    assert.ok(categories.includes(expected), `${fixture.id}: expected category ${expected}, got [${categories.join(", ")}]`);
  }
  const unexpected = categories.filter((category) => !fixture.expect.includes(category));
  assert.equal(unexpected.length, 0, `${fixture.id}: unexpected categories [${unexpected.join(", ")}]`);
  validateReadModelShape(report, `fixture:${fixture.id}`);
}

// 2. Negative fixture: a clean managed doc must produce zero findings.
const cleanReport = generateAuditorReport({
  profiles: [
    fixtureProfile("clean", "stale-source.md", {
      warn_after_days: 100000,
      source_of_truth_pattern: /Source of truth：\s*`?(\.\/stale-source\.md)`?/,
    }),
  ],
  write: false,
  now: "2026-07-03T00:00:00+08:00",
});
assert.equal(cleanReport.findings.length, 0, `clean fixture must produce no findings, got ${cleanReport.findings.length}`);

// 3. Real target run: structural assertions only. Do NOT freeze live finding counts
//    or specific categories here — the target document is expected to change
//    (architecture-pulse-source-edit); freezing live state is how verifiers rot.
const realReport = generateAuditorReport({ write: false });
validateReadModelShape(realReport, "real:architecture-pulse");
assert.equal(realReport.targets[0].target_id, "architecture_docs.ARCHITECTURE");
assert.ok(realReport.targets[0].checks.length >= 5, "real run must execute the profile check set");
assert.ok(realReport.targets[0].sections.length > 0, "real run must classify sections");

console.log(`MorroWise auditor generator verification OK — ${FIXTURES.length} fixtures strict, real target structural (${realReport.findings.length} findings)`);

function validateReadModelShape(model, label) {
  for (const key of REQUIRED_TOP_LEVEL) {
    assert.ok(Object.hasOwn(model, key), `${label}: missing top-level ${key}`);
  }
  assert.equal(model.schema_version, "morrowise-auditor.v0", `${label}: schema_version`);
  assert.equal(model.read_only, true, `${label}: read_only`);
  assertReadOnlyBoundary(model.write_boundary, `${label}.write_boundary`);
  assert.equal(model.summary.finding_count, model.findings.length, `${label}: summary finding_count mismatch`);
  assert.equal(model.summary.target_count, model.targets.length, `${label}: summary target_count mismatch`);

  const targetIds = new Set(model.targets.map((target) => target.target_id));
  for (const target of model.targets) {
    assert.match(target.target_path, /^\$COLLAB\//, `${label}/${target.target_id}: target_path must use $COLLAB`);
    assertReadOnlyBoundary(target.write_boundary, `${label}/${target.target_id}.write_boundary`);
    for (const check of target.checks) {
      assert.ok(["pass", "warning", "fail", "missing", "unknown"].includes(check.result), `${label}: bad check result ${check.result}`);
    }
  }
  for (const finding of model.findings) {
    for (const key of REQUIRED_FINDING_FIELDS) {
      assert.ok(Object.hasOwn(finding, key), `${label}/${finding.id}: finding missing ${key}`);
    }
    assert.ok(targetIds.has(finding.target_id), `${label}/${finding.id}: unknown target_id`);
    assert.ok(CATEGORY_ENUM.has(finding.category), `${label}/${finding.id}: unknown category ${finding.category}`);
    assert.match(finding.evidence_ref, /^\$COLLAB\/|^task:|^schema:|^command:|^manual:/, `${label}/${finding.id}: evidence_ref must be traceable`);
  }
  for (const action of model.next_actions) {
    assert.ok(taskIds.has(action.owner_task), `${label}/${action.id}: owner_task must exist in morrowise tasks`);
  }
}

function assertReadOnlyBoundary(boundary, label) {
  assert.deepEqual(boundary.allowed, ["report", "recommend", "draft_task"], `${label}: allowed actions mismatch`);
  for (const action of ["edit_source", "close_task", "commit", "push", "external_sync"]) {
    assert.ok(boundary.forbidden.includes(action), `${label}: missing forbidden ${action}`);
  }
}
