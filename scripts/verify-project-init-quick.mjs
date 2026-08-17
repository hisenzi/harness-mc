#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const initScript = path.join(root, "scripts", "new-project.py");
const projectInitSkill = path.resolve(
  root,
  "..",
  "notyet-harness",
  "000_Agent",
  "skills",
  "project-init",
  "SKILL.md",
);
const syncMcSkill = path.resolve(
  root,
  "..",
  "notyet-harness",
  "000_Agent",
  "skills",
  "sync-mc",
  "SKILL.md",
);
const syncMcVerifier = path.resolve(
  root,
  "..",
  "notyet-harness",
  "000_Agent",
  "skills",
  "sync-mc",
  "scripts",
  "verify-mc-project.mjs",
);

function topologyFixture() {
  const today = new Date().toISOString().slice(0, 10);
  return {
    registry_id: "morrowise-project-topology.v1",
    maintenance_policy: {
      evidence_warn_after_days: 30,
    },
    records: [
      {
        id: "harness-mc",
        path_label: "$COLLAB/harness-mc",
        classification: "canonical_project",
        migration_state: "inventory_only",
        project_home_ref: "$COLLAB/harness-mc",
        topology_profile: "git-repository",
        document_ref: null,
        repo_ref: "$COLLAB/harness-mc",
        evidence: ["$COLLAB/harness-mc"],
        last_verified_at: today,
        notes: "Isolated quick-mode verifier fixture.",
      },
    ],
  };
}

function runQuick(taskCount, adjustTasks = (tasks) => tasks) {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "project-init-quick-"));
  const collabRoot = path.join(fixtureRoot, "Claude_協作");
  const fixtureMc = path.join(collabRoot, "harness-mc");
  const milestonesRoot = path.join(fixtureMc, "milestones");
  const topologyPath = path.join(fixtureMc, "topology.json");
  const projectFolder = path.join(collabRoot, "visual-template-system");
  const tasksFile = path.join(fixtureRoot, "mvp-tasks.json");
  fs.mkdirSync(milestonesRoot, { recursive: true });
  fs.writeFileSync(topologyPath, `${JSON.stringify(topologyFixture(), null, 2)}\n`);
  const mvpTasks = Array.from({ length: taskCount }, (_, index) => ({
    id: `mvp-task-${index + 1}`,
    title: `MVP 任務 ${index + 1}`,
    done_condition: `MVP 任務 ${index + 1} 的可觀察結果已確認`,
  }));
  fs.writeFileSync(tasksFile, `${JSON.stringify(adjustTasks(mvpTasks), null, 2)}\n`);

  const result = spawnSync(
    "python3",
    [
      initScript,
      "quick",
      "--id",
      "visual-template-system",
      "--name",
      "視覺模板系統",
      "--desc",
      "依指定模板編號產生一致風格的視覺成品。",
      "--project-code",
      "VTS",
      "--project-folder",
      projectFolder,
      "--why-open",
      "把既有模板圖與生成流程整合成可重複使用的系統。",
      "--mvp-goal",
      "完成一款指定模板的最小端到端製作。",
      "--final-goal",
      "建立可持續擴充的視覺模板製作系統。",
      "--mvp-tasks-file",
      tasksFile,
      "--collab-root",
      collabRoot,
      "--milestones-root",
      milestonesRoot,
      "--topology-registry",
      topologyPath,
    ],
    { cwd: root, encoding: "utf8" },
  );

  return {
    fixtureRoot,
    collabRoot,
    milestonesRoot,
    topologyPath,
    projectFolder,
    result,
  };
}

function verifyQuickArtifacts(fixture, taskCount) {
  assert.equal(fixture.result.status, 0, fixture.result.stderr || fixture.result.stdout);

  const readmePath = path.join(fixture.projectFolder, "README.md");
  const milestoneDir = path.join(fixture.milestonesRoot, "visual-template-system");
  const projectPath = path.join(milestoneDir, "project.json");
  const tasksPath = path.join(milestoneDir, "tasks.json");
  assert.ok(fs.existsSync(readmePath), "quick must create README.md in the project folder");
  assert.ok(fs.existsSync(projectPath), "quick must create minimal project.json");
  assert.ok(fs.existsSync(tasksPath), "quick must create tasks.json");

  const project = JSON.parse(fs.readFileSync(projectPath, "utf8"));
  assert.equal(project.project_code, "VTS");
  assert.equal(project.project_folder, "$COLLAB/visual-template-system");
  assert.equal(project.why_opened, "把既有模板圖與生成流程整合成可重複使用的系統。");
  assert.equal(project.mvp_goal, "完成一款指定模板的最小端到端製作。");
  assert.equal(project.final_goal, "建立可持續擴充的視覺模板製作系統。");
  for (const deferredField of ["type", "goals", "risks", "metric", "due", "system_growth_gate"]) {
    assert.ok(!(deferredField in project), `${deferredField} must be deferred until formalize`);
  }

  const tasks = JSON.parse(fs.readFileSync(tasksPath, "utf8")).tasks;
  assert.equal(tasks.length, taskCount + 2, "quick-open and formalize checkpoint wrap supplied MVP tasks");
  assert.equal(tasks[0].id, "quick-open");
  assert.equal(tasks[0].order_label, "VTS-MVP-01");
  for (let index = 0; index < taskCount; index += 1) {
    assert.equal(tasks[index + 1].id, `mvp-task-${index + 1}`);
    assert.equal(tasks[index + 1].order_label, `VTS-MVP-${String(index + 2).padStart(2, "0")}`);
  }
  assert.equal(tasks.at(-1).id, "formalize");
  assert.equal(
    tasks.at(-1).order_label,
    `VTS-MVP-${String(taskCount + 2).padStart(2, "0")}`,
  );
  assert.ok(tasks.every((task) => typeof task.done_condition === "string" && task.done_condition.trim()));

  const topology = JSON.parse(fs.readFileSync(fixture.topologyPath, "utf8"));
  const record = topology.records.find((entry) => entry.id === "visual-template-system");
  assert.ok(record, "quick must register the project folder in topology");
  assert.equal(record.path_label, "$COLLAB/visual-template-system");
  assert.equal(record.classification, "canonical_project");
  assert.equal(record.project_home_ref, record.path_label);

  assert.ok(!fs.existsSync(path.join(fixture.projectFolder, ".git")), "quick must not initialize Git");
  assert.ok(
    !fs.existsSync(path.join(fixture.collabRoot, "harness-mc", "public", "data", "projects.json")),
    "quick must not rebuild the MC global read model",
  );
}

const fixtures = [];
try {
  for (const taskCount of [1, 4]) {
    const fixture = runQuick(taskCount);
    fixtures.push(fixture);
    verifyQuickArtifacts(fixture, taskCount);
  }

  const missingAcceptance = runQuick(1, (tasks) => {
    delete tasks[0].done_condition;
    return tasks;
  });
  fixtures.push(missingAcceptance);
  assert.notEqual(missingAcceptance.result.status, 0, "MVP task without acceptance must be rejected");
  assert.match(missingAcceptance.result.stderr, /缺少驗收標準/);

  const skillText = fs.readFileSync(projectInitSkill, "utf8");
  assert.match(skillText, /quick/);
  assert.match(skillText, /PROJECT_CODE-MVP-NN/);
  assert.match(skillText, /不執行 Git／GitHub/);
  assert.match(skillText, /不執行.*MC 全域資料重建/);

  const initSource = fs.readFileSync(initScript, "utf8");
  const quickCreateBody = initSource.slice(
    initSource.indexOf("def quick_create("),
    initSource.indexOf("def make_project_json("),
  );
  for (const forbiddenCall of [
    "setup_standalone_repo(",
    "rebuild_mc(",
    "SYNC_SCRIPT",
    "GEN_DATA",
    "update_architecture(",
  ]) {
    assert.ok(!quickCreateBody.includes(forbiddenCall), `quick must not call ${forbiddenCall}`);
  }

  const generateDataSource = fs.readFileSync(path.join(root, "scripts", "generate-data.mjs"), "utf8");
  assert.match(generateDataSource, /orderLabelAsSource: usesOrderLabel/);
  assert.match(generateDataSource, /task_ordering: "order_label"/);
  const projectsPageSource = fs.readFileSync(path.join(root, "app", "projects", "page.tsx"), "utf8");
  assert.match(projectsPageSource, /selected\.task_ordering === "order_label"/);

  const syncSkillText = fs.readFileSync(syncMcSkill, "utf8");
  assert.match(syncSkillText, /generate-data\.mjs/);
  assert.match(syncSkillText, /verify-mc-project\.mjs/);
  assert.doesNotMatch(syncSkillText, /Obsidian|Canvas|Heptabase/);

  const syncFixture = fixtures[0];
  const syncTasksPath = path.join(
    syncFixture.milestonesRoot,
    "visual-template-system",
    "tasks.json",
  );
  const syncTasks = JSON.parse(fs.readFileSync(syncTasksPath, "utf8")).tasks;
  const shuffledSyncTasksPath = path.join(syncFixture.fixtureRoot, "tasks-shuffled.json");
  fs.writeFileSync(
    shuffledSyncTasksPath,
    `${JSON.stringify({ tasks: [...syncTasks].reverse() }, null, 2)}\n`,
  );
  const mcDataPath = path.join(syncFixture.fixtureRoot, "projects.json");
  fs.writeFileSync(mcDataPath, `${JSON.stringify([{
    project: "visual-template-system",
    project_code: "VTS",
    task_ordering: "order_label",
    tasks: syncTasks,
  }], null, 2)}\n`);
  const syncVerification = spawnSync(
    "node",
    [
      syncMcVerifier,
      "--project",
      "visual-template-system",
      "--tasks",
      shuffledSyncTasksPath,
      "--data",
      mcDataPath,
    ],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(syncVerification.status, 0, syncVerification.stderr || syncVerification.stdout);

  const mismatchedMcDataPath = path.join(syncFixture.fixtureRoot, "projects-mismatch.json");
  const mismatchedTasks = structuredClone(syncTasks);
  mismatchedTasks[0].order_label = "VTS-MVP-99";
  fs.writeFileSync(mismatchedMcDataPath, `${JSON.stringify([{
    project: "visual-template-system",
    project_code: "VTS",
    task_ordering: "order_label",
    tasks: mismatchedTasks,
  }], null, 2)}\n`);
  const mismatchVerification = spawnSync(
    "node",
    [
      syncMcVerifier,
      "--project",
      "visual-template-system",
      "--tasks",
      shuffledSyncTasksPath,
      "--data",
      mismatchedMcDataPath,
    ],
    { cwd: root, encoding: "utf8" },
  );
  assert.notEqual(mismatchVerification.status, 0, "MC mismatch must fail closed");
  assert.match(mismatchVerification.stderr, /task id\/order_label mismatch/);

  console.log("project-init quick verification OK");
} finally {
  for (const fixture of fixtures) {
    fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true });
  }
}
