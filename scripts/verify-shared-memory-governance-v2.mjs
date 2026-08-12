import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const collabRoot = path.resolve(root, "..");
const notyetRoot = path.join(collabRoot, "notyet-harness");
const memoryRoot = path.join(notyetRoot, "000_Agent", "memory");
const sharedMemoryPath = path.join(memoryRoot, "MEMORY.md");
const skillsRoot = path.join(notyetRoot, "000_Agent", "skills");
const registryPath = path.join(
  root,
  "system-workflow",
  "registries",
  "morrowise-shared-memory-governance-v2.json",
);
const specPath = path.join(
  root,
  "system-workflow",
  "docs",
  "specs",
  "shared-memory-governance-v2.md",
);
const tasksPath = path.join(root, "milestones", "morrowise", "tasks.json");
const codexMemoryPath = path.join(
  process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
  "memories",
  "MEMORY.md",
);

const phase = process.argv.includes("--phase")
  ? process.argv[process.argv.indexOf("--phase") + 1]
  : "full";
const allowedPhases = new Set(["r1-baseline", "r1", "r2", "r3", "r4", "full"]);
assert.ok(allowedPhases.has(phase), `unsupported JV-49 phase: ${phase}`);

for (const requiredPath of [registryPath, specPath, tasksPath, sharedMemoryPath]) {
  assert.ok(fs.existsSync(requiredPath), `required JV-49 artifact missing: ${portable(requiredPath)}`);
}

const registry = readJson(registryPath);
const spec = fs.readFileSync(specPath, "utf8");
const tasks = readJson(tasksPath).tasks || [];
const task = tasks.find((candidate) => candidate.id === "shared-memory-governance-v2");

assert.ok(task, "canonical JV-49 task anchor is missing");
assert.equal(task.order_label, "JV-49", "JV-49 order label drifted");
assert.equal(registry.contract_id, "shared-memory-governance-v2.r1");
assert.equal(registry.task_id, "shared-memory-governance-v2");
assert.equal(registry.write_boundary?.current_phase, "read_only_inventory");
assert.equal(registry.write_boundary?.source_mutations_performed, false);
assert.match(spec, /Recommendation Engine.+Approval Policy.+Runner/s);
assert.match(spec, /不得.*第二套.*queue|不得.*平行.*queue/s);
assert.match(spec, /Max One/);

verifyTaxonomy(registry);
verifyMemorySectionInventory(registry);
verifySkillInventory(registry);
verifyIngressInventory(registry);
verifyDatedLogLedger(registry);
verifyQueryBaseline(registry);
verifyCandidateSourceBoundary(registry);

if (registry.phase_status?.r1 === "inventory_complete_migration_pending") {
  verifyFrozenBaseline(registry);
}

if (phase === "r1-baseline") {
  console.log("JV-49 R1 baseline inventory verification OK (no source mutation)");
  process.exit(0);
}

if (phase === "r1") {
  assert.equal(
    registry.phase_status?.r1,
    "complete",
    "JV-49 R1 remains pending: apply the approved migration, record after_fingerprint, and rerun five-query comparison",
  );
  verifyR1Completion(registry);
  console.log("JV-49 R1 verification OK");
  process.exit(0);
}

const requiredCompletedPhases = phase === "full" ? ["r1", "r2", "r3", "r4"] : [phase];
for (const requiredPhase of requiredCompletedPhases) {
  assert.equal(
    registry.phase_status?.[requiredPhase],
    "complete",
    `JV-49 ${requiredPhase.toUpperCase()} is not complete`,
  );
}
assert.fail(`JV-49 ${phase} verification contract is intentionally unavailable before that phase is implemented`);

function verifyTaxonomy(value) {
  const expectedLayers = [
    "l0_rules",
    "l1_shared_active_memory",
    "domain_skill",
    "architecture",
    "canonical_task_state",
    "daily_raw_log",
    "l2_archive",
    "agent_adapter_memory",
  ];
  assert.deepEqual(
    value.taxonomy.map((item) => item.id),
    expectedLayers,
    "memory taxonomy must preserve the eight agreed source boundaries",
  );
  assert.equal(value.l1_content_budget.hard_max_lines, 150);
  assert.ok(value.l1_content_budget.target_max_lines < value.l1_content_budget.hard_max_lines);
  assert.equal(value.l1_content_budget.quality_gate, "five_query_no_regression");
}

function verifyMemorySectionInventory(value) {
  const allowed = new Set([
    "retain",
    "move-to-skill",
    "move-to-architecture",
    "archive",
    "needs-review",
  ]);
  const inventory = value.memory_section_inventory;
  assert.equal(inventory.length, value.before_fingerprint.shared_memory.section_count);
  for (const item of inventory) {
    assert.ok(item.id && item.heading && item.source_ref, "every L1 section needs an id, heading, and source ref");
    assert.ok(allowed.has(item.classification), `invalid L1 classification: ${item.classification}`);
    assert.ok(item.reason, `missing classification reason: ${item.id}`);
    assert.ok(item.proposed_target, `missing proposed target: ${item.id}`);
    assert.ok(item.recovery, `missing recovery note: ${item.id}`);
  }
  assert.equal(new Set(inventory.map((item) => item.id)).size, inventory.length, "L1 inventory ids must be unique");
}

function verifySkillInventory(value) {
  const names = fs
    .readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(skillsRoot, entry.name, "SKILL.md")))
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(names, value.skills_snapshot.names, "R1 skill inventory does not match the observed skill set");
  assert.equal(value.skills_snapshot.count, names.length);
  const maxmodel = value.skill_candidates.find((item) => item.id === "maxmodel-case-page");
  assert.ok(maxmodel, "maxmodel-case-page must be classified explicitly");
  assert.equal(maxmodel.classification, "retain");
  assert.equal(maxmodel.owns_domain_rule, "Max One source-copy conditional branch");
}

function verifyIngressInventory(value) {
  const requiredIngresses = [
    "$COLLAB/notyet-harness/000_Agent/skills/cross-agent-memory/SKILL.md",
    "$COLLAB/notyet-harness/000_Agent/skills/project-init/SKILL.md",
    "$COLLAB/notyet-harness/000_Agent/skills/build-skill/SKILL.md",
    "$COLLAB/notyet-harness/000_Agent/skills/hisenzi-skill-builder/SKILL.md",
    "$COLLAB/notyet-harness/000_Agent/skills/capture-insight/SKILL.md",
    "$COLLAB/notyet-harness/000_Agent/skills/cc-log/SKILL.md",
    "$COLLAB/harness-mc/scripts/new-project.py",
    "$COLLAB/harness-mc/scripts/generate-morrowise-auditor.mjs",
  ];
  const indexed = new Set(value.memory_ingress_inventory.map((item) => item.source_ref));
  for (const sourceRef of requiredIngresses) {
    assert.ok(indexed.has(sourceRef), `required memory ingress is not classified: ${sourceRef}`);
  }
  for (const item of value.memory_ingress_inventory) {
    assert.ok(["retain", "archive", "needs-review"].includes(item.classification));
    assert.ok(item.observed_behavior && item.proposed_behavior && item.reason);
  }
}

function verifyDatedLogLedger(value) {
  assert.equal(value.dated_log_inventory.root_count, 14);
  assert.equal(value.dated_log_inventory.daily_same_name_different, 12);
  assert.equal(value.dated_log_inventory.daily_missing, 2);
  assert.equal(value.dated_log_inventory.archive_existed_before, false);
  assert.equal(value.migration_ledger.length, 14);
  for (const item of value.migration_ledger) {
    assert.match(item.source_sha256, /^[a-f0-9]{64}$/);
    assert.ok(["different", "missing"].includes(item.daily_relation));
    assert.equal(item.classification, "archive");
    assert.equal(item.action_status, "proposed_no_write");
    assert.match(item.proposed_target, /^\$COLLAB\/notyet-harness\/000_Agent\/memory\/archive\//);
    assert.ok(item.recovery_path && item.diff_evidence);
  }
}

function verifyQueryBaseline(value) {
  assert.equal(value.representative_queries.length, 5);
  const ids = value.representative_queries.map((query) => query.id);
  assert.deepEqual(ids, [
    "maxmodel-max-one-rule",
    "canonical-task-state",
    "shared-memory-owner",
    "dated-log-location",
    "codex-to-shared-promotion",
  ]);
  for (const query of value.representative_queries) {
    assert.ok(query.question && query.before_result && query.expected_route);
    assert.ok(Array.isArray(query.evidence_refs) && query.evidence_refs.length > 0);
    assert.equal(query.after_result, null, `after result must remain empty before migration: ${query.id}`);
  }
}

function verifyCandidateSourceBoundary(value) {
  const source = value.local_codex_candidate_source;
  assert.equal(source.path, "$CODEX_HOME/memories/MEMORY.md");
  assert.equal(source.role, "candidate_source_only");
  assert.equal(source.bulk_import_allowed, false);
  assert.equal(source.content_copied_into_registry, false);
  assert.deepEqual(source.required_candidate_fields, [
    "source",
    "reason",
    "dedupe_comparison",
    "target_layer",
    "sensitivity",
    "vincent_approval",
  ]);
}

function verifyFrozenBaseline(value) {
  const memoryText = fs.readFileSync(sharedMemoryPath, "utf8");
  assert.equal(countLines(memoryText), value.before_fingerprint.shared_memory.lines);
  assert.equal(Buffer.byteLength(memoryText), value.before_fingerprint.shared_memory.bytes);
  assert.equal(sha256(memoryText), value.before_fingerprint.shared_memory.sha256);

  const rootLogs = fs
    .readdirSync(memoryRoot)
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name))
    .sort();
  assert.deepEqual(rootLogs, value.migration_ledger.map((item) => path.basename(item.source_ref)));
  for (const item of value.migration_ledger) {
    const sourcePath = resolvePortable(item.source_ref);
    assert.equal(sha256(fs.readFileSync(sourcePath)), item.source_sha256, `root log changed: ${item.source_ref}`);
    const dailyPath = resolvePortable(item.daily_ref);
    if (item.daily_relation === "missing") {
      assert.equal(fs.existsSync(dailyPath), false, `daily relation changed: ${item.daily_ref}`);
    } else {
      assert.ok(fs.existsSync(dailyPath), `daily comparison target missing: ${item.daily_ref}`);
      assert.equal(sha256(fs.readFileSync(dailyPath)), item.daily_sha256, `daily log changed: ${item.daily_ref}`);
      assert.notEqual(item.source_sha256, item.daily_sha256, `different relation is false: ${item.source_ref}`);
    }
  }

  if (fs.existsSync(codexMemoryPath)) {
    const codexText = fs.readFileSync(codexMemoryPath, "utf8");
    assert.equal(countLines(codexText), value.before_fingerprint.local_codex_memory.lines);
    assert.equal(Buffer.byteLength(codexText), value.before_fingerprint.local_codex_memory.bytes);
    assert.equal(sha256(codexText), value.before_fingerprint.local_codex_memory.sha256);
  }
}

function verifyR1Completion(value) {
  assert.ok(value.after_fingerprint, "R1 after_fingerprint is missing");
  assert.ok(value.representative_queries.every((query) => query.after_result), "five-query after comparison is incomplete");
  assert.ok(value.migration_ledger.every((item) => item.action_status === "verified"));
  assert.equal(value.write_boundary.source_mutations_performed, true);
}

function resolvePortable(ref) {
  if (ref.startsWith("$COLLAB/")) return path.join(collabRoot, ref.slice("$COLLAB/".length));
  if (ref.startsWith("$CODEX_HOME/")) {
    const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
    return path.join(codexHome, ref.slice("$CODEX_HOME/".length));
  }
  throw new Error(`non-portable source ref: ${ref}`);
}

function portable(filePath) {
  if (filePath.startsWith(collabRoot)) return `$COLLAB${filePath.slice(collabRoot.length)}`;
  if (filePath.startsWith(path.dirname(codexMemoryPath))) return "$CODEX_HOME/memories/MEMORY.md";
  return filePath;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function countLines(text) {
  return (text.match(/\n/g) || []).length + (text.endsWith("\n") ? 0 : 1);
}
