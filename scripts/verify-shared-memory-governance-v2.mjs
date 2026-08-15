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
const architecturePath = path.join(notyetRoot, "000_Agent", "ARCHITECTURE.md");
const archiveManifestPath = path.join(memoryRoot, "archive", "MANIFEST.json");
const skillsRoot = path.join(notyetRoot, "000_Agent", "skills");
const promotionAdapterRegistryPath = path.join(
  root,
  "system-workflow",
  "registries",
  "morrowise-memory-promotion-adapter.json",
);
const promotionFixturesRoot = path.join(root, "scripts", "fixtures", "shared-memory-governance-v2");
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

for (const requiredPath of [registryPath, specPath, tasksPath, sharedMemoryPath, architecturePath]) {
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
assert.ok(
  ["read_only_inventory", "r1_complete", "r2_complete", "r3_complete", "r4_complete"].includes(
    registry.write_boundary?.current_phase,
  ),
  "JV-49 write boundary phase is invalid",
);
assert.equal(typeof registry.write_boundary?.source_mutations_performed, "boolean");
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

if (phase === "r1-baseline") {
  if (registry.phase_status?.r1 === "inventory_complete_migration_pending") {
    verifyFrozenBaseline(registry);
    console.log("JV-49 R1 baseline inventory verification OK (no source mutation)");
  } else {
    verifyHistoricalBaseline(registry);
    console.log("JV-49 R1 historical baseline evidence OK");
  }
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

if (phase === "r2") {
  assert.equal(registry.phase_status?.r1, "complete", "JV-49 R1 must pass before R2");
  assert.equal(
    registry.phase_status?.r2,
    "complete",
    "JV-49 R2 remains pending: fix every active memory ingress and add the archive manifest",
  );
  verifyR1Completion(registry);
  verifyR2Completion(registry);
  console.log("JV-49 R2 verification OK");
  process.exit(0);
}

if (phase === "r3") {
  assert.equal(registry.phase_status?.r1, "complete", "JV-49 R1 must pass before R3");
  assert.equal(registry.phase_status?.r2, "complete", "JV-49 R2 must pass before R3");
  assert.equal(
    registry.phase_status?.r3,
    "complete",
    "JV-49 R3 remains pending: implement the promotion adapter and deterministic decision fixtures",
  );
  verifyR1Completion(registry);
  verifyR2Completion(registry);
  await verifyR3Completion();
  console.log("JV-49 R3 verification OK");
  process.exit(0);
}

if (phase === "r4" || phase === "full") {
  for (const requiredPhase of ["r1", "r2", "r3", "r4"]) {
    assert.equal(
      registry.phase_status?.[requiredPhase],
      "complete",
      `JV-49 ${requiredPhase.toUpperCase()} is not complete`,
    );
  }
  verifyR1Completion(registry);
  verifyR2Completion(registry);
  await verifyR3Completion();
  verifyR4Completion(registry, task);
  console.log(phase === "full" ? "JV-49 full verification OK" : "JV-49 R4 verification OK");
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
  const currentNames = new Set(names);
  assert.equal(value.skills_snapshot.count, value.skills_snapshot.names.length);
  for (const baselineName of value.skills_snapshot.names) {
    assert.ok(currentNames.has(baselineName), `R1 baseline skill disappeared: ${baselineName}`);
  }
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
  const migrationComplete = value.phase_status?.r1 === "complete";
  for (const item of value.migration_ledger) {
    assert.match(item.source_sha256, /^[a-f0-9]{64}$/);
    assert.ok(["different", "missing"].includes(item.daily_relation));
    assert.equal(item.classification, "archive");
    assert.equal(item.action_status, migrationComplete ? "verified" : "proposed_no_write");
    assert.match(item.proposed_target, /^\$COLLAB\/notyet-harness\/000_Agent\/memory\/archive\//);
    assert.ok(item.recovery_path && item.diff_evidence);
    if (migrationComplete) {
      assert.equal(item.target_sha256, item.source_sha256, `archive checksum drifted: ${item.source_ref}`);
      assert.ok(item.verified_at, `archive verification date missing: ${item.source_ref}`);
    }
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
    if (value.phase_status?.r1 === "complete") {
      assert.equal(query.after_result?.status, "pass", `after query did not pass: ${query.id}`);
      assert.equal(query.after_result?.regression, "none", `query regressed: ${query.id}`);
      assert.ok(query.after_result?.answer && query.after_result?.source_ref, `after evidence missing: ${query.id}`);
    } else {
      assert.equal(query.after_result, null, `after result must remain empty before migration: ${query.id}`);
    }
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
  assert.ok(
    ["r1_complete", "r2_complete", "r3_complete", "r4_complete"].includes(value.write_boundary.current_phase),
    "write boundary must be at R1 or a later completed JV-49 phase",
  );

  const memoryText = fs.readFileSync(sharedMemoryPath, "utf8");
  assert.equal(countLines(memoryText), value.after_fingerprint.shared_memory.lines);
  assert.equal(Buffer.byteLength(memoryText), value.after_fingerprint.shared_memory.bytes);
  assert.equal(sha256(memoryText), value.after_fingerprint.shared_memory.sha256);
  assert.ok(countLines(memoryText) <= value.l1_content_budget.target_max_lines, "shared L1 exceeds target budget");
  assert.match(memoryText, /maxmodel-case-page\/SKILL\.md/);
  assert.match(memoryText, /milestones\/\*\/tasks\.json/);
  assert.match(memoryText, /memory\/daily\/YYYY-MM-DD\.md/);
  assert.match(memoryText, /Vincent.*核准|核准.*Vincent/);
  for (const staleDetail of ["22/28 done", "23/31 done", "Token 401", "目前 2.22", "8/11 done"]) {
    assert.ok(!memoryText.includes(staleDetail), `volatile L1 detail remains: ${staleDetail}`);
  }

  const architectureText = fs.readFileSync(architecturePath, "utf8");
  assert.match(architectureText, /任一 Agent.*candidate/s);
  assert.match(architectureText, /Vincent.*核准/s);
  assert.ok(!architectureText.includes("手動 + janitor 歸檔（HiSenzi 管理，CC 唯讀）"));

  verifyHistoricalBaseline(value);

  const rootLogs = fs
    .readdirSync(memoryRoot)
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name));
  assert.deepEqual(rootLogs, [], "legacy root dated logs still exist after R1 migration");
  for (const item of value.migration_ledger) {
    const sourcePath = resolvePortable(item.source_ref);
    const targetPath = resolvePortable(item.proposed_target);
    assert.equal(fs.existsSync(sourcePath), false, `legacy root log still exists: ${item.source_ref}`);
    assert.ok(fs.existsSync(targetPath), `archive target missing: ${item.proposed_target}`);
    assert.equal(sha256(fs.readFileSync(targetPath)), item.source_sha256, `archive hash mismatch: ${item.proposed_target}`);

    const dailyPath = resolvePortable(item.daily_ref);
    if (item.daily_relation === "missing") {
      assert.equal(fs.existsSync(dailyPath), false, `daily relation changed: ${item.daily_ref}`);
    } else {
      assert.ok(fs.existsSync(dailyPath), `daily comparison target missing: ${item.daily_ref}`);
      assert.equal(sha256(fs.readFileSync(dailyPath)), item.daily_sha256, `daily log changed: ${item.daily_ref}`);
    }
  }
}

function verifyHistoricalBaseline(value) {
  const snapshot = value.historical_snapshot;
  assert.ok(snapshot?.path, "R1 historical snapshot path is missing");
  const snapshotPath = resolvePortable(snapshot.path);
  assert.ok(fs.existsSync(snapshotPath), "R1 historical snapshot is missing");
  const snapshotText = fs.readFileSync(snapshotPath, "utf8");
  assert.equal(countLines(snapshotText), value.before_fingerprint.shared_memory.lines);
  assert.equal(Buffer.byteLength(snapshotText), value.before_fingerprint.shared_memory.bytes);
  assert.equal(sha256(snapshotText), value.before_fingerprint.shared_memory.sha256);
  assert.equal(snapshot.sha256, value.before_fingerprint.shared_memory.sha256);
}

function verifyR2Completion(value) {
  assert.ok(
    ["r2_complete", "r3_complete", "r4_complete"].includes(value.write_boundary.current_phase),
    "write boundary must be at R2 or a later completed JV-49 phase",
  );
  assert.ok(fs.existsSync(archiveManifestPath), "JV-49 archive manifest is missing");
  const manifest = readJson(archiveManifestPath);
  assert.equal(manifest.schema_version, "morrowise.shared-memory-archive-manifest.v1");
  assert.equal(
    manifest.source_of_truth,
    "$COLLAB/harness-mc/system-workflow/registries/morrowise-shared-memory-governance-v2.json#/migration_ledger",
  );
  assert.equal(manifest.entries.length, 15, "archive manifest must contain the L1 snapshot and 14 dated logs");
  assert.equal(new Set(manifest.entries.map((item) => item.target_ref)).size, manifest.entries.length);
  for (const item of manifest.entries) {
    const targetPath = resolvePortable(item.target_ref);
    assert.ok(fs.existsSync(targetPath), `archive manifest target missing: ${item.target_ref}`);
    assert.equal(sha256(fs.readFileSync(targetPath)), item.sha256, `archive manifest hash mismatch: ${item.target_ref}`);
    assert.ok(item.source_ref && item.recovery_path && item.verified_at);
  }

  for (const ingress of value.memory_ingress_inventory) {
    const resolution = ingress.resolution;
    assert.equal(resolution?.status, "verified", `memory ingress is unresolved: ${ingress.source_ref}`);
    assert.ok(
      ["candidate_flow", "daily_only_no_promotion", "removed_automatic_memory_write"].includes(resolution.outcome),
      `memory ingress outcome is invalid: ${ingress.source_ref}`,
    );
    const sourcePath = resolvePortable(ingress.source_ref);
    assert.ok(fs.existsSync(sourcePath), `memory ingress source missing: ${ingress.source_ref}`);
    const sourceText = fs.readFileSync(sourcePath, "utf8");
    for (const marker of resolution.expected_markers || []) {
      assert.ok(sourceText.includes(marker), `memory ingress marker missing (${marker}): ${ingress.source_ref}`);
    }
    for (const marker of resolution.forbidden_markers || []) {
      assert.ok(!sourceText.includes(marker), `stale memory ingress marker remains (${marker}): ${ingress.source_ref}`);
    }
  }
}

async function verifyR3Completion() {
  assert.ok(fs.existsSync(promotionAdapterRegistryPath), "JV-49 promotion adapter registry is missing");
  const adapterRegistry = readJson(promotionAdapterRegistryPath);
  assert.equal(adapterRegistry.adapter_id, "morrowise-memory-promotion-adapter.v1");
  assert.equal(adapterRegistry.status, "active_contract");
  assert.equal(
    adapterRegistry.reuses_existing.recommendation_engine,
    "$COLLAB/harness-mc/system-workflow/registries/morrowise-recommendation-engine.json",
  );
  assert.equal(
    adapterRegistry.reuses_existing.approval_policy,
    "$COLLAB/harness-mc/system-workflow/registries/morrowise-approval-policy.json#memory_write_or_update",
  );
  assert.equal(
    adapterRegistry.reuses_existing.runner,
    "$COLLAB/harness-mc/scripts/morrowise-action-runner.mjs",
  );
  assert.equal(adapterRegistry.reuses_existing.task_lifecycle, "JV-32/JV-40");
  assert.deepEqual(adapterRegistry.new_runtime_components, ["candidate_adapter"]);
  assert.deepEqual(adapterRegistry.forbidden_parallel_components, {
    queue: false,
    scheduler: false,
    dashboard: false,
    rag: false,
    vector_database: false,
    task_source: false,
  });

  const fixtureNames = [
    "unapproved",
    "duplicate",
    "sensitive",
    "machine-local",
    "raw-rollout",
    "unverified",
    "rejected",
    "approved",
  ];
  const fixtures = Object.fromEntries(
    fixtureNames.map((name) => {
      const fixturePath = path.join(promotionFixturesRoot, `${name}.json`);
      assert.ok(fs.existsSync(fixturePath), `JV-49 R3 fixture missing: ${name}`);
      return [name, readJson(fixturePath)];
    }),
  );
  const { evaluateMemoryPromotionCandidate, processMemoryPromotionCandidate } = await import("./morrowise-memory-promotion-adapter.mjs");
  const { runMorrowiseActionRunner } = await import("./morrowise-action-runner.mjs");
  const realMemoryBefore = sha256(fs.readFileSync(sharedMemoryPath));
  const blockedExpectations = {
    duplicate: "duplicate_candidate",
    sensitive: "sensitive_candidate",
    "machine-local": "machine_local_source",
    "raw-rollout": "raw_rollout_source",
    unverified: "unverified_source",
    rejected: "rejected_candidate",
  };

  const unapproved = processMemoryPromotionCandidate(fixtures.unapproved, { root, collabRoot });
  assert.equal(unapproved.decision, "approval_required");
  assert.equal(unapproved.writes_performed, 0);
  assert.equal(unapproved.runner_output.output_type, "approval_request");

  for (const [name, reasonCode] of Object.entries(blockedExpectations)) {
    const result = processMemoryPromotionCandidate(fixtures[name], { root, collabRoot });
    assert.equal(result.decision, "blocked", `${name} candidate must be blocked`);
    assert.equal(result.reason_code, reasonCode, `${name} candidate reason drifted`);
    assert.equal(result.writes_performed, 0, `${name} candidate performed a write`);
  }

  const approvedPlan = processMemoryPromotionCandidate(fixtures.approved, { root, collabRoot });
  assert.equal(approvedPlan.decision, "approved_plan");
  assert.equal(approvedPlan.writes_performed, 0);
  assert.equal(approvedPlan.runner_output.output_type, "memory_promotion_plan");

  const approvedHandoff = evaluateMemoryPromotionCandidate(fixtures.approved).runner_candidate;
  const bypassCandidate = structuredClone(approvedHandoff);
  bypassCandidate.payload.source.ref = "/Users/example/.codex/memories/MEMORY.md#bypass";
  assert.throws(
    () => runMorrowiseActionRunner({ candidates: [bypassCandidate] }, { root, collabRoot, writeMemoryPromotions: true }),
    /source ref must be portable/,
    "direct Runner calls must not bypass the adapter's machine-local source boundary",
  );

  const tempCollab = fs.mkdtempSync(path.join(os.tmpdir(), "jv49-memory-promotion-"));
  try {
    const targetPath = path.join(tempCollab, "notyet-harness", "000_Agent", "memory", "MEMORY.md");
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const initialText = "# Temporary shared memory\n";
    fs.writeFileSync(targetPath, initialText);
    const approvedCandidate = structuredClone(fixtures.approved);
    approvedCandidate.mutation.expected_preimage_sha256 = sha256(initialText);
    const lockPath = `${targetPath}.morrowise-memory.lock`;
    fs.writeFileSync(lockPath, "held by another fixture", { flag: "wx" });
    assert.throws(
      () => processMemoryPromotionCandidate(approvedCandidate, {
        root,
        collabRoot: tempCollab,
        writeMemoryPromotions: true,
      }),
      /EEXIST/,
      "concurrent memory promotion must fail closed on the existing lock",
    );
    assert.equal(fs.readFileSync(targetPath, "utf8"), initialText);
    fs.rmSync(lockPath);
    const applied = processMemoryPromotionCandidate(approvedCandidate, {
      root,
      collabRoot: tempCollab,
      writeMemoryPromotions: true,
    });
    assert.equal(applied.decision, "applied");
    assert.equal(applied.writes_performed, 1);
    assert.equal(applied.runner_output.output_type, "memory_promotion_receipt");
    assert.equal(applied.runner_output.target_ref, approvedCandidate.target.ref);
    assert.equal(fs.readFileSync(targetPath, "utf8"), initialText + approvedCandidate.mutation.exact_text);
    assert.equal(applied.runner_output.after_sha256, sha256(fs.readFileSync(targetPath)));
  } finally {
    fs.rmSync(tempCollab, { recursive: true, force: true });
  }

  assert.equal(sha256(fs.readFileSync(sharedMemoryPath)), realMemoryBefore, "R3 fixtures mutated the real shared L1");
}

function verifyR4Completion(value, canonicalTask) {
  assert.equal(value.write_boundary.current_phase, "r4_complete");
  const evaluation = value.r4_evaluation;
  assert.equal(evaluation?.quality_basis, "discoverability_integrity_and_governance_not_size_alone");
  assert.deepEqual(evaluation.discoverability, {
    query_count: 5,
    passed: 5,
    regressions: 0,
    source_attributed: 5,
  });
  assert.equal(evaluation.l1.before_lines, value.before_fingerprint.shared_memory.lines);
  assert.equal(evaluation.l1.after_lines, value.after_fingerprint.shared_memory.lines);
  assert.equal(evaluation.l1.before_sections, value.before_fingerprint.shared_memory.section_count);
  assert.equal(evaluation.l1.after_sections, 5);
  assert.equal(evaluation.archive.manifest_entries, 15);
  assert.equal(evaluation.archive.checksum_failures, 0);
  assert.equal(evaluation.ingress.verified, value.memory_ingress_inventory.length);
  assert.equal(evaluation.ingress.stale_markers, 0);
  assert.equal(evaluation.promotion.fixtures, 8);
  assert.equal(evaluation.promotion.unapproved_or_blocked_zero_write, 7);
  assert.equal(evaluation.promotion.approved_exact_target_writes, 1);
  assert.equal(evaluation.promotion.real_shared_l1_fixture_writes, 0);
  assert.equal(evaluation.parallel_components_added, 0);

  const architectureRegistryPath = path.join(
    root,
    "system-workflow",
    "registries",
    "morrowise-architecture-subsystems.json",
  );
  const architectureRegistry = readJson(architectureRegistryPath);
  const admission = architectureRegistry.records.find((record) => record.id === "shared-memory-governance");
  assert.ok(admission, "shared-memory-governance Architecture Admission Record is missing");
  assert.equal(admission.status, "active");
  assert.equal(admission.architecture_decision, "promoted");
  assert.equal(admission.task_anchor, "$COLLAB/harness-mc/milestones/morrowise/tasks.json#shared-memory-governance-v2");
  assert.ok(admission.verifiers.includes("node scripts/verify-shared-memory-governance-v2.mjs"));
  assert.match(fs.readFileSync(architecturePath, "utf8"), /shared-memory-governance/);

  assert.equal(canonicalTask.architecture_decision?.decision, "promoted");
  assert.equal(canonicalTask.architecture_decision?.admission_review?.record_id, "shared-memory-governance");
  const currentMatrixFingerprint = `sha256:${sha256(JSON.stringify(canonicalTask.acceptance_matrix))}`;
  assert.equal(value.acceptance_receipt?.matrix_fingerprint, currentMatrixFingerprint);
  assert.deepEqual(value.acceptance_receipt?.required_ids, ["JV49-R1-A01", "JV49-R2-A01", "JV49-R3-A01", "JV49-R4-A01"]);
  assert.equal(value.acceptance_receipt?.exact_id_coverage, true);
  assert.equal(value.acceptance_receipt?.all_passed, true);
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
