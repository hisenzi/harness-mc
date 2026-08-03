#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyTaskEvents } from "./apply-task-events.mjs";
import { generateVisualSyncCoverage } from "./generate-visual-sync-coverage.mjs";
import { generateCommitAttention } from "./generate-commit-attention.mjs";
import { generateCloseoutResidualLedger } from "./generate-closeout-residual-ledger.mjs";
import { runMorrowiseActionRunner } from "./morrowise-action-runner.mjs";
import { discoverMilestoneProjects } from "./lib/milestone-projects.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const initScript = path.join(repoRoot, "scripts", "new-project.py");
const caseIndex = process.argv.indexOf("--case");
const requestedCase = caseIndex >= 0 ? process.argv[caseIndex + 1] : null;
const supportedCases = new Set(["project-init", "discovery", "lifecycle", "compatibility", "source-immutability"]);
if (requestedCase && !supportedCases.has(requestedCase)) throw new Error(`unknown verification case: ${requestedCase}`);
const collabRoot = process.env.COLLAB_ROOT ? path.resolve(process.env.COLLAB_ROOT) : path.resolve(repoRoot, "..");
const sourceKj = path.join(collabRoot, "CC本機協作_無Git", "KJ", "260623_KJ_光榮獅_吉祥物");
const existingKjMilestone = path.join(repoRoot, "milestones", "kj-bilingual");
assert.equal(fs.existsSync(sourceKj), true, "KJ source precondition is missing");
assert.equal(fs.existsSync(existingKjMilestone), true, "kj-bilingual precondition is missing");
const sourceInventoryBefore = metadataInventoryDigest(sourceKj);
const existingMilestoneBefore = metadataInventoryDigest(existingKjMilestone);

function runInit({ id = "kj-mascot", group = "kj", folderDate = "260803" } = {}) {
  const args = [
    initScript,
    "--id", id,
    "--name", "KJ 光榮獅角色與量產基準設定",
    "--desc", "建立可延伸至視覺、造型與量產周邊的 KJ 吉祥物角色基準。",
    "--type", "internal",
    "--problem", "KJ 吉祥物缺少可供視覺與立體量產共用的角色設定正本。",
    "--impact", "避免未來平面、絨毛與軟膠製作各自產生不一致版本。",
    "--metric", "共用角色與量產基準的交付覆蓋率",
    "--baseline", "0%",
    "--target", "100%",
    "--due", "2026-08-31",
    "--measurement-source", "node scripts/verify-grouped-nested-milestones.mjs",
    "--dry-run",
  ];
  if (group !== null) args.push("--group", group);
  if (folderDate !== null) args.push("--folder-date", folderDate);
  return spawnSync("python3", args, { cwd: repoRoot, encoding: "utf8" });
}

const target = path.join(repoRoot, "milestones", "kj", "260803-kj-mascot");
assert.equal(fs.existsSync(target), false, "test precondition: live KJ target must not exist");
const result = runInit();
assert.equal(result.status, 0, result.stderr || result.stdout);
const preview = JSON.parse(result.stdout);
assert.deepEqual(preview.project.milestone, {
  layout: "grouped-v1",
  project_id: "kj-mascot",
  group: "kj",
  folder_date: "260803",
  relative_ref: "milestones/kj/260803-kj-mascot",
});
assert.equal(fs.existsSync(target), false, "grouped dry-run wrote the live target");

for (const invalid of [
  { group: "unknown-group" },
  { folderDate: "260231" },
  { group: "../kj" },
  { id: "../kj-mascot" },
  { group: null, folderDate: "260803" },
]) {
  const rejected = runInit(invalid);
  assert.notEqual(rejected.status, 0, `invalid grouped candidate was accepted: ${JSON.stringify(invalid)}`);
}

const duplicate = runInit({ id: "kj-bilingual" });
assert.notEqual(duplicate.status, 0, "flat/nested duplicate project ID must fail before create");

const createFixtureCollab = fs.mkdtempSync(path.join(os.tmpdir(), "grouped-milestone-create-"));
try {
  const createFixtureRepo = path.join(createFixtureCollab, "harness-mc");
  for (const relative of [
    "scripts/new-project.py",
    "scripts/milestone-project-index.mjs",
    "scripts/lib/milestone-projects.mjs",
    "scripts/project-write-admission.mjs",
    "scripts/project-topology-health.mjs",
    "scripts/lib/collab-root.mjs",
    "milestones/kj/group.json",
  ]) {
    copyRelative(repoRoot, createFixtureRepo, relative);
  }
  const topologyPath = path.join(
    createFixtureRepo,
    "system-workflow",
    "registries",
    "morrowise-project-topology.json",
  );
  fs.mkdirSync(path.dirname(topologyPath), { recursive: true });
  fs.writeFileSync(
    topologyPath,
    `${JSON.stringify({
      registry_id: "morrowise-project-topology.v1",
      maintenance_policy: { evidence_warn_after_days: 30 },
      records: [
        {
          id: "harness-mc",
          path_label: "$COLLAB/harness-mc",
          classification: "canonical_project",
          migration_state: "inventory_only",
          project_home_ref: "$COLLAB/harness-mc",
          last_verified_at: "2026-08-03",
        },
      ],
    }, null, 2)}\n`,
  );

  const fakeBin = path.join(createFixtureRepo, ".test-bin");
  const ghInvocation = path.join(createFixtureCollab, "gh-invoked");
  fs.mkdirSync(fakeBin, { recursive: true });
  const fakeGh = path.join(fakeBin, "gh");
  fs.writeFileSync(fakeGh, `#!/bin/sh\nprintf invoked > "${ghInvocation}"\nexit 97\n`);
  fs.chmodSync(fakeGh, 0o755);

  const created = spawnSync(
    "python3",
    [
      path.join(createFixtureRepo, "scripts", "new-project.py"),
      "--id", "kj-mascot",
      "--name", "KJ 光榮獅角色與量產基準設定",
      "--desc", "隔離 fixture 驗證 grouped milestone create。",
      "--type", "internal",
      "--problem", "KJ 吉祥物缺少可供視覺與立體量產共用的角色設定正本。",
      "--impact", "避免未來平面、絨毛與軟膠製作各自產生不一致版本。",
      "--metric", "共用角色與量產基準的交付覆蓋率",
      "--baseline", "0%",
      "--target", "100%",
      "--due", "2026-08-31",
      "--measurement-source", "node scripts/verify-grouped-nested-milestones.mjs",
      "--group", "kj",
      "--folder-date", "260803",
      "--no-sync",
      "--topology-registry", topologyPath,
    ],
    {
      cwd: createFixtureRepo,
      encoding: "utf8",
      env: { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}` },
    },
  );
  assert.equal(created.status, 0, created.stderr || created.stdout);
  const createdDir = path.join(createFixtureRepo, "milestones", "kj", "260803-kj-mascot");
  assert.deepEqual(fs.readdirSync(createdDir).sort(), ["project.json", "tasks.json"]);
  const createdProject = JSON.parse(fs.readFileSync(path.join(createdDir, "project.json"), "utf8"));
  assert.deepEqual(createdProject.milestone, {
    layout: "grouped-v1",
    project_id: "kj-mascot",
    group: "kj",
    folder_date: "260803",
    relative_ref: "milestones/kj/260803-kj-mascot",
  });
  assert.deepEqual(createdProject.repo_creation, { create_repo: false, approval_ref: null });
  assert.equal(fs.existsSync(ghInvocation), false, "project-init invoked gh without a repo receipt");
} finally {
  fs.rmSync(createFixtureCollab, { recursive: true, force: true });
}

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "grouped-milestone-discovery-"));
try {
  copy("scripts/generate-data.mjs");
  copy("scripts/task-state.mjs");
  copy("scripts/lib/milestone-projects.mjs");
  copy("lib/taskOrdering.mjs");
  copy("system-workflow/registries/pai-domain-taxonomy.json");

  writeJson("milestones/flat-project/project.json", { name: "Flat project", status: "active" });
  writeJson("milestones/flat-project/tasks.json", {
    tasks: [{ id: "flat-task", title: "Flat task", status: "todo" }],
  });
  writeJson("milestones/kj/group.json", {
    schema_version: "morrowise.milestone-group.v1",
    id: "kj",
    name: "KJ",
    layout: "grouped-yymmdd-project-v1",
    max_project_depth: 1,
  });
  writeJson("milestones/kj/260803-kj-mascot/project.json", {
    name: "KJ mascot",
    status: "active",
    milestone: {
      layout: "grouped-v1",
      project_id: "kj-mascot",
      group: "kj",
      folder_date: "260803",
      relative_ref: "milestones/kj/260803-kj-mascot",
    },
  });
  writeJson("milestones/kj/260803-kj-mascot/tasks.json", {
    tasks: [
      {
        id: "mascot-task",
        title: "Mascot visual-sync task",
        status: "todo",
        external_refs: { heptabase: { whiteboard: "Fixture", card_id: "mascot-card" } },
      },
      { id: "mascot-completed", title: "Mascot completed task", status: "completed", commits: [] },
    ],
  });

  const generated = spawnSync("node", [path.join(fixtureRoot, "scripts", "generate-data.mjs")], {
    cwd: fixtureRoot,
    encoding: "utf8",
  });
  assert.equal(generated.status, 0, generated.stderr || generated.stdout);
  const projects = JSON.parse(fs.readFileSync(path.join(fixtureRoot, "public", "data", "projects.json"), "utf8"));
  assert.deepEqual(
    projects.map((project) => project.project).sort(),
    ["flat-project", "kj-mascot"],
    "generated projects read model omitted or duplicated a grouped project",
  );
  const nested = projects.find((project) => project.project === "kj-mascot");
  assert.equal(nested.group, "kj");
  assert.equal(nested.milestone_ref, "milestones/kj/260803-kj-mascot");

  const validation = spawnSync(
    "node",
    [path.join(repoRoot, "scripts", "validate-tasks.mjs"), "--project", "kj-mascot"],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, HARNESS_MC_ROOT: fixtureRoot },
    },
  );
  assert.equal(validation.status, 0, validation.stderr || validation.stdout);
  assert.match(
    `${validation.stdout}\n${validation.stderr}`,
    /task=mascot-task/,
    "validator returned green without reading the grouped tasks.json",
  );

  const preflight = spawnSync(
    "node",
    [
      path.join(repoRoot, "scripts", "work-anchor-preflight.mjs"),
      "--project", "kj-mascot",
      "--task-id", "mascot-task",
      "--intent", "開始",
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, HARNESS_MC_ROOT: fixtureRoot },
    },
  );
  assert.equal(preflight.status, 0, preflight.stderr || preflight.stdout);
  assert.match(preflight.stdout, /task source: milestones\/kj\/260803-kj-mascot\/tasks\.json/);
  assert.match(preflight.stdout, /result: allow/);

  const visualCoverage = generateVisualSyncCoverage({ root: fixtureRoot, write: false });
  assert.ok(
    visualCoverage.tracked_tasks.some((task) => task.project === "kj-mascot" && task.task_id === "mascot-task"),
    "visual sync coverage omitted a grouped project task",
  );

  const commitAttention = generateCommitAttention({
    root: fixtureRoot,
    write: false,
    worktrees: {
      repositories: [
        {
          repo: "harness-mc",
          status: "uncommitted",
          staged_count: 0,
          unstaged_count: 1,
          untracked_count: 0,
          local_commits_count: 0,
          remote_commits_count: 0,
          files: [{ path: "milestones/kj/260803-kj-mascot/tasks.json" }],
        },
      ],
    },
  });
  const harnessAttention = commitAttention.repositories.find((repo) => repo.repo === "harness-mc");
  assert.ok(harnessAttention.candidate_projects.includes("kj-mascot"), "commit attention omitted grouped project identity");

  const residualLedger = generateCloseoutResidualLedger({
    root: fixtureRoot,
    write: false,
    commitAttention: { repositories: [] },
    worktrees: { repositories: [] },
    cleanupPlan: { plans: [] },
    taskEvents: {},
    pendingTaskEvents: [],
  });
  assert.ok(
    residualLedger.completed_without_commit_evidence.some(
      (item) => item.project === "kj-mascot" && item.task_id === "mascot-completed",
    ),
    "closeout residual ledger omitted a grouped completed task",
  );

  const nestedTaskSource = "$COLLAB/harness-mc/milestones/kj/260803-kj-mascot/tasks.json";
  const nestedGoalRef = "$COLLAB/harness-mc/milestones/kj/260803-kj-mascot/project.json#/goals";
  assert.doesNotThrow(() => runMorrowiseActionRunner(
    {
      policy: { policy_tiers: [], runner_gate: { default_policy: "approval_required" } },
      candidates: [
        {
          recommendation_id: "nested-governance-candidate",
          candidate_type: "propose_next_task",
          suggested_action: "propose_next_task",
          suggested_task_id: "nested-next-task",
          risk_level: "medium",
          requires_approval: true,
          target_project: "kj-mascot",
          target_task_source: nestedTaskSource,
          goal_ref: nestedGoalRef,
          source_task_refs: [`${nestedTaskSource}#mascot-task`],
          evidence_refs: [nestedTaskSource],
          observed_gap: "fixture gap",
          proposed_operation: "create",
          proposed_done_condition: "fixture done condition",
          limitations: ["proposal only"],
        },
      ],
    },
    { root: fixtureRoot },
  ));

  writeJson("task-events/pending/grouped-blocked.json", {
    event_id: "grouped-blocked",
    type: "task.blocked",
    project: "kj-mascot",
    task_id: "mascot-task",
    actor: "codex",
    session_id: "jv48-verifier",
    created_at: "2026-08-03T00:00:00+08:00",
  });
  const report = applyTaskEvents({
    root: fixtureRoot,
    runGenerateData: false,
    writeLatestReport: false,
  });
  assert.equal(report.applied.length, 1, JSON.stringify(report));
  const nestedState = JSON.parse(
    fs.readFileSync(path.join(fixtureRoot, "milestones", "kj", "260803-kj-mascot", "state.json"), "utf8"),
  );
  assert.equal(nestedState.tasks["mascot-task"].status, "blocked");
  assert.equal(fs.existsSync(path.join(fixtureRoot, "milestones", "kj-mascot", "state.json")), false);
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}

for (const setup of [
  (root) => {
    writeJsonAt(root, "milestones/duplicate/project.json", { name: "Flat duplicate" });
    writeJsonAt(root, "milestones/duplicate/tasks.json", { tasks: [] });
    writeGroupAt(root, "kj");
    writeJsonAt(root, "milestones/kj/260803-duplicate/project.json", groupedProject("duplicate"));
    writeJsonAt(root, "milestones/kj/260803-duplicate/tasks.json", { tasks: [] });
  },
  (root) => {
    writeJsonAt(root, "milestones/unknown/260803-project/tasks.json", { tasks: [] });
  },
  (root) => {
    writeGroupAt(root, "kj");
    writeJsonAt(root, "milestones/kj/subgroup/260803-project/tasks.json", { tasks: [] });
  },
  (root) => {
    writeGroupAt(root, "kj", { unexpected: true });
    writeJsonAt(root, "milestones/kj/260803-project/project.json", groupedProject("project"));
    writeJsonAt(root, "milestones/kj/260803-project/tasks.json", { tasks: [] });
  },
  (root) => {
    writeGroupAt(root, "kj");
    writeJsonAt(root, "milestones/kj/260231-project/tasks.json", { tasks: [] });
  },
]) {
  const invalidRoot = fs.mkdtempSync(path.join(os.tmpdir(), "grouped-milestone-invalid-"));
  try {
    setup(invalidRoot);
    const before = metadataInventoryDigest(invalidRoot);
    assert.throws(() => discoverMilestoneProjects({ repoRoot: invalidRoot }));
    assert.equal(metadataInventoryDigest(invalidRoot), before, "failed discovery mutated its fixture");
  } finally {
    fs.rmSync(invalidRoot, { recursive: true, force: true });
  }
}

assert.equal(metadataInventoryDigest(sourceKj), sourceInventoryBefore, "KJ source metadata changed during verification");
assert.equal(
  metadataInventoryDigest(existingKjMilestone),
  existingMilestoneBefore,
  "kj-bilingual metadata changed during verification",
);

function copy(relativePath) {
  const destination = path.join(fixtureRoot, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(path.join(repoRoot, relativePath), destination);
}

function writeJson(relativePath, value) {
  const destination = path.join(fixtureRoot, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, `${JSON.stringify(value, null, 2)}\n`);
}

function writeJsonAt(root, relativePath, value) {
  const destination = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, `${JSON.stringify(value, null, 2)}\n`);
}

function writeGroupAt(root, group, overrides = {}) {
  writeJsonAt(root, `milestones/${group}/group.json`, {
    schema_version: "morrowise.milestone-group.v1",
    id: group,
    name: group.toUpperCase(),
    layout: "grouped-yymmdd-project-v1",
    max_project_depth: 1,
    ...overrides,
  });
}

function groupedProject(projectId) {
  return {
    name: projectId,
    milestone: {
      layout: "grouped-v1",
      project_id: projectId,
      group: "kj",
      folder_date: "260803",
      relative_ref: `milestones/kj/260803-${projectId}`,
    },
  };
}

function metadataInventoryDigest(root) {
  const hash = crypto.createHash("sha256");
  walkMetadata(root, root, hash);
  return hash.digest("hex");
}

function copyRelative(sourceRoot, targetRoot, relative) {
  const source = path.join(sourceRoot, relative);
  const target = path.join(targetRoot, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function walkMetadata(root, current, hash) {
  for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = path.join(current, entry.name);
    const stat = fs.lstatSync(absolute);
    hash.update(`${entry.isDirectory() ? "d" : entry.isFile() ? "f" : "o"}:${path.relative(root, absolute)}:${stat.size}:${stat.mtimeMs}\0`);
    if (entry.isDirectory()) walkMetadata(root, absolute, hash);
  }
}

console.log("grouped nested milestone verification OK — JV48-A01..A05");
