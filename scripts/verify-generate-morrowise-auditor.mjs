import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  generateAuditorReport,
  ARCHITECTURE_PULSE_PROFILE,
  HARNESS_GOVERNANCE_PROFILE,
  MEMORY_HEALTH_PROFILE,
} from "./generate-morrowise-auditor.mjs";

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
//    (now is pinned so the fixture's Updated date stays inside its own Warn after window.)
const cleanReport = generateAuditorReport({
  profiles: [fixtureProfile("clean", "clean-managed-doc.md")],
  write: false,
  now: "2026-07-03T00:00:00+08:00",
});
assert.equal(cleanReport.findings.length, 0, `clean fixture must produce no findings, got ${cleanReport.findings.length}`);

// 2b. Harness governance profile fixtures (JV-14): synthetic dirs lock the
//     header-class contract, patch-status format, and residual-reference checks.
function harnessFixtureProfile(id, dirName) {
  return {
    ...HARNESS_GOVERNANCE_PROFILE,
    target_id_prefix: `harness_governance.fixture-${id}`,
    dir: `${fixtureDir}/harness-governance/${dirName}`,
    tasks_root: `${fixtureDir}/harness-governance/milestones`,
  };
}

const HG_FIXTURES = [
  { id: "degraded", dir: "hg-degraded", expect: ["missing_header"] },
  { id: "patch-plan", dir: "hg-patch-plan", expect: ["fake_live_risk"] },
  { id: "residual", dir: "hg-residual", expect: ["source_missing", "historical_used_as_active"] },
];

for (const fixture of HG_FIXTURES) {
  const report = generateAuditorReport({
    profiles: [harnessFixtureProfile(fixture.id, fixture.dir)],
    write: false,
    now: "2026-07-03T00:00:00+08:00",
  });
  const categories = report.findings.map((finding) => finding.category);
  for (const expected of fixture.expect) {
    assert.ok(categories.includes(expected), `hg:${fixture.id}: expected category ${expected}, got [${categories.join(", ")}]`);
  }
  const unexpected = categories.filter((category) => !fixture.expect.includes(category));
  assert.equal(unexpected.length, 0, `hg:${fixture.id}: unexpected categories [${unexpected.join(", ")}]`);
  validateReadModelShape(report, `hg-fixture:${fixture.id}`);
}

// 缺 header 檔 → degraded：target classification 降為 unknown，header check fail
const degradedReport = generateAuditorReport({
  profiles: [harnessFixtureProfile("degraded-target", "hg-degraded")],
  write: false,
  now: "2026-07-03T00:00:00+08:00",
});
const degradedTarget = degradedReport.targets[0];
assert.equal(degradedTarget.classification, "unknown", "missing-header protocol doc must degrade to unknown classification");
assert.equal(degradedTarget.checks.find((check) => check.id === "header-contract")?.result, "fail");

// residual fixture：墓碑檔本身必須被標 historical、不產 findings
const residualReport = generateAuditorReport({
  profiles: [harnessFixtureProfile("residual-tombstone", "hg-residual")],
  write: false,
  now: "2026-07-03T00:00:00+08:00",
});
const tombstoneTarget = residualReport.targets.find((target) => target.target_path.endsWith("tombstoned-note.md"));
assert.equal(tombstoneTarget.classification, "historical", "tombstoned doc must classify as historical");
assert.equal(tombstoneTarget.expected_identity, "historical");
assert.ok(
  residualReport.findings.every((finding) => !finding.target_id.endsWith(".tombstoned-note")),
  "tombstoned doc itself must not emit findings",
);

// clean harness dir → zero findings（含 strict protocol + lenient evidence 各一）
const hgCleanReport = generateAuditorReport({
  profiles: [harnessFixtureProfile("clean", "hg-clean")],
  write: false,
  now: "2026-07-03T00:00:00+08:00",
});
assert.equal(hgCleanReport.findings.length, 0, `hg clean fixture must produce no findings, got ${hgCleanReport.findings.length}`);
const cleanIdentities = new Set(hgCleanReport.targets.map((target) => target.expected_identity));
assert.ok(cleanIdentities.has("protocol") && cleanIdentities.has("evidence"), "clean fixture must exercise both header classes");

// 2c. Memory health profile fixture (JV-16): stale daily memory + missing workflow_link,
//     with completeness/freshness pinned to unknown — the scanner must not fake live.
const mhFixtureRoot = `${fixtureDir}/memory-health/stale-memory`;
const memoryHealthSink = [];
const mhReport = generateAuditorReport({
  profiles: [
    {
      ...MEMORY_HEALTH_PROFILE,
      target_id_prefix: "memory_health.fixture",
      daily_dir: `${mhFixtureRoot}/memory/daily`,
      skills_dir: `${mhFixtureRoot}/skills`,
      areas: [
        {
          id: "memory_layer.l1",
          source_family: "memory_layer",
          knowledge_area: "fixture L1",
          path: `${mhFixtureRoot}/memory/MEMORY.md`,
          reference_patterns: ["MEMORY.md"],
          maintenance_owner: "fixture",
          known_gaps: [],
        },
        {
          id: "memory_layer.daily",
          source_family: "memory_layer",
          knowledge_area: "fixture daily",
          path: `${mhFixtureRoot}/memory/daily`,
          reference_patterns: ["memory/daily"],
          maintenance_owner: "fixture",
          known_gaps: [],
        },
        {
          id: "second_brain.orphan",
          source_family: "second_brain",
          knowledge_area: "fixture 孤兒知識區",
          path: `${mhFixtureRoot}/brain`,
          reference_patterns: ["never-referenced-pattern"],
          maintenance_owner: "fixture",
          known_gaps: [],
        },
      ],
    },
  ],
  write: false,
  now: "2026-07-03T00:00:00+08:00",
  memoryHealthSink,
});
const mhCategories = mhReport.findings.map((finding) => finding.category);
assert.ok(mhCategories.includes("stale_warning"), `mh fixture: expected stale_warning, got [${mhCategories.join(", ")}]`);
assert.equal(
  mhCategories.filter((category) => category !== "stale_warning").length,
  0,
  `mh fixture: unexpected categories [${mhCategories.join(", ")}]`,
);
validateReadModelShape(mhReport, "mh-fixture:stale-memory");

const mhModel = memoryHealthSink[0];
assert.equal(mhModel.schema_version, "memory-health.v0");
const orphanArea = mhModel.areas.find((area) => area.id === "second_brain.orphan");
assert.deepEqual(orphanArea.workflow_links, [], "orphan area must have no workflow links");
assert.ok(orphanArea.known_gaps.some((gap) => gap.includes("missing workflow_link")), "orphan area must record the missing workflow_link gap");
assert.equal(orphanArea.completeness_state, "unknown", "scanner must not fake completeness");
assert.equal(orphanArea.freshness_state, "unknown", "unreferenced area must stay unknown, not fake live");
const dailyArea = mhModel.areas.find((area) => area.id === "memory_layer.daily");
assert.ok(dailyArea.workflow_links.includes("skill:daily-writer"), "daily area must pick up its skill workflow link");
const l1Area = mhModel.areas.find((area) => area.id === "memory_layer.l1");
assert.equal(l1Area.last_used_at, "2026-06-20", "L1 last_used_at must be inferred from daily reference");
assert.equal(l1Area.confidence.last_used_at, "inferred");

// 3. Real target run: structural assertions only. Do NOT freeze live finding counts
//    or specific categories here — the target document is expected to change
//    (architecture-pulse-source-edit); freezing live state is how verifiers rot.
const realReport = generateAuditorReport({ write: false });
validateReadModelShape(realReport, "real:architecture-pulse");
assert.equal(realReport.targets[0].target_id, "architecture_docs.ARCHITECTURE");
assert.ok(realReport.targets[0].checks.length >= 5, "real run must execute the profile check set");
assert.ok(realReport.targets[0].sections.length > 0, "real run must classify sections");

// Harness governance real run: structural only — file set and states will evolve.
const realHarnessTargets = realReport.targets.filter((target) => target.source_family === "harness_governance");
assert.ok(realHarnessTargets.length >= 5, "harness governance profile must scan the docs dir");
for (const target of realHarnessTargets) {
  assert.ok(["protocol", "evidence", "historical"].includes(target.expected_identity), `bad identity ${target.expected_identity}`);
  assert.ok(target.checks.some((check) => check.id === "header-contract"), `${target.target_id}: header check must run`);
}

console.log(
  `MorroWise auditor generator verification OK — ${FIXTURES.length}+${HG_FIXTURES.length} fixtures strict, real targets structural (${realReport.findings.length} findings, ${realHarnessTargets.length} harness docs)`,
);

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
