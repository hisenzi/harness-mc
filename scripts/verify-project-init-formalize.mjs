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

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function topologyFixture() {
  const today = new Date().toISOString().slice(0, 10);
  return {
    registry_id: "morrowise-project-topology.v1",
    maintenance_policy: { evidence_warn_after_days: 30 },
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
        notes: "Isolated formalize verifier fixture.",
      },
    ],
  };
}

function runInit(args) {
  return spawnSync("python3", [initScript, ...args], {
    cwd: root,
    encoding: "utf8",
  });
}

function createQuickFixture() {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "project-init-formalize-"));
  const collabRoot = path.join(fixtureRoot, "Claude_協作");
  const fixtureMc = path.join(collabRoot, "harness-mc");
  const milestonesRoot = path.join(fixtureMc, "milestones");
  const topologyPath = path.join(fixtureMc, "topology.json");
  const projectFolder = path.join(collabRoot, "visual-template-system");
  const mvpTasksPath = path.join(fixtureRoot, "mvp-tasks.json");
  fs.mkdirSync(milestonesRoot, { recursive: true });
  writeJson(topologyPath, topologyFixture());
  writeJson(mvpTasksPath, [
    {
      id: "mvp-build",
      title: "完成指定模板的最小製作流程",
      done_condition: "指定模板可產出一份可檢視成品。",
    },
  ]);

  const quick = runInit([
    "quick",
    "--id", "visual-template-system",
    "--name", "視覺模板系統",
    "--desc", "依指定模板編號產生一致風格的視覺成品。",
    "--project-code", "VTS",
    "--project-folder", projectFolder,
    "--why-open", "把既有模板圖與生成流程整合成可重複使用的系統。",
    "--mvp-goal", "完成一款指定模板的最小端到端製作。",
    "--final-goal", "建立可持續擴充的視覺模板製作系統。",
    "--mvp-tasks-file", mvpTasksPath,
    "--collab-root", collabRoot,
    "--milestones-root", milestonesRoot,
    "--topology-registry", topologyPath,
  ]);
  assert.equal(quick.status, 0, quick.stderr || quick.stdout);

  const milestoneDir = path.join(milestonesRoot, "visual-template-system");
  const projectPath = path.join(milestoneDir, "project.json");
  const tasksPath = path.join(milestoneDir, "tasks.json");
  const readmePath = path.join(projectFolder, "README.md");
  const tasksData = readJson(tasksPath);
  tasksData.tasks.find((task) => task.id === "mvp-build").status = "done";
  tasksData.tasks.find((task) => task.id === "mvp-build").mvp_result = "模板編號可正確選取，但仍需補搜尋與分類。";
  tasksData.tasks.push({
    id: "mvp-added-later",
    title: "補做測試中發現的 MVP 任務",
    status: "todo",
    track: "mvp",
    order_label: "VTS-MVP-04",
    dependencies: [],
    done_condition: "測試中發現的必要項目已有可觀察結果。",
  });
  writeJson(tasksPath, tasksData);

  return {
    fixtureRoot,
    collabRoot,
    milestonesRoot,
    topologyPath,
    projectFolder,
    projectPath,
    tasksPath,
    readmePath,
  };
}

function formalizePayload(overrides = {}) {
  return {
    mvp_test_results: [
      "模板編號可正確選取",
      "需要正式補上模板搜尋、分類與輸出一致性驗證",
    ],
    goals: ["建立可依模板編號重複產出一致視覺成品的正式系統"],
    risks: ["模板 metadata 不一致會造成搜尋與輸出風格偏差"],
    metric: "指定模板編號的端到端產出驗收通過率",
    due: "2026-09-30",
    system_growth_gate: {
      decision: "MVP 結果支持進入正式建構",
      evidence: "指定模板流程已完成最小端到端測試",
    },
    tasks: [
      {
        id: "template-catalog",
        title: "建立模板目錄與編號查找",
        done_condition: "使用模板編號可找到唯一模板及其必要 metadata。",
      },
      {
        id: "formal-output",
        title: "建立正式視覺輸出流程",
        done_condition: "指定模板編號可完成一份符合模板風格的正式成品。",
      },
    ],
    ...overrides,
  };
}

function runFormalize(fixture, payload) {
  const formalizePath = path.join(fixture.fixtureRoot, "formalize.json");
  writeJson(formalizePath, payload);
  return runInit([
    "formalize",
    "--id", "visual-template-system",
    "--formalize-file", formalizePath,
    "--collab-root", fixture.collabRoot,
    "--milestones-root", fixture.milestonesRoot,
    "--topology-registry", fixture.topologyPath,
  ]);
}

const fixtures = [];
try {
  const fixture = createQuickFixture();
  fixtures.push(fixture);
  const beforeProject = readJson(fixture.projectPath);
  const beforeTasks = readJson(fixture.tasksPath);
  const beforeReadme = fs.readFileSync(fixture.readmePath, "utf8");
  const beforeTopology = fs.readFileSync(fixture.topologyPath, "utf8");

  const result = runFormalize(fixture, formalizePayload());
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const project = readJson(fixture.projectPath);
  const tasks = readJson(fixture.tasksPath).tasks;
  for (const [key, value] of Object.entries(beforeProject)) {
    if (key === "tracks") continue;
    assert.deepEqual(project[key], value, `formalize must preserve existing project field ${key}`);
  }
  assert.deepEqual(project.tracks, { ...beforeProject.tracks, formal: "正式執行" });
  assert.deepEqual(project.goals, formalizePayload().goals);
  assert.deepEqual(project.risks, formalizePayload().risks);
  assert.equal(project.metric, formalizePayload().metric);
  assert.equal(project.due, formalizePayload().due);
  assert.deepEqual(project.system_growth_gate, formalizePayload().system_growth_gate);

  assert.deepEqual(
    tasks.slice(0, beforeTasks.tasks.length),
    beforeTasks.tasks,
    "formalize must not alter MVP task identities or records",
  );
  assert.deepEqual(tasks.slice(beforeTasks.tasks.length), [
    {
      id: "template-catalog",
      title: "建立模板目錄與編號查找",
      status: "todo",
      track: "formal",
      order_label: "VTS-01",
      dependencies: [],
      done_condition: "使用模板編號可找到唯一模板及其必要 metadata。",
    },
    {
      id: "formal-output",
      title: "建立正式視覺輸出流程",
      status: "todo",
      track: "formal",
      order_label: "VTS-02",
      dependencies: [],
      done_condition: "指定模板編號可完成一份符合模板風格的正式成品。",
    },
  ]);

  assert.equal(fs.readFileSync(fixture.readmePath, "utf8"), beforeReadme, "formalize must not rebuild README");
  assert.equal(fs.readFileSync(fixture.topologyPath, "utf8"), beforeTopology, "formalize must not rewrite topology");
  assert.ok(!fs.existsSync(path.join(fixture.projectFolder, ".git")), "formalize must not initialize Git");
  assert.ok(
    !fs.existsSync(path.join(fixture.collabRoot, "harness-mc", "public", "data", "projects.json")),
    "formalize must not rebuild MC data",
  );

  const missingResults = createQuickFixture();
  fixtures.push(missingResults);
  const rejectedResults = runFormalize(missingResults, formalizePayload({ mvp_test_results: [] }));
  assert.notEqual(rejectedResults.status, 0, "formalize without MVP test results must be rejected");
  assert.match(rejectedResults.stderr, /MVP 測試結果/);

  const missingAcceptance = createQuickFixture();
  fixtures.push(missingAcceptance);
  const invalidTasks = formalizePayload();
  delete invalidTasks.tasks[0].done_condition;
  const rejectedTask = runFormalize(missingAcceptance, invalidTasks);
  assert.notEqual(rejectedTask.status, 0, "formal task without acceptance must be rejected");
  assert.match(rejectedTask.stderr, /缺少驗收標準/);

  const skillText = fs.readFileSync(projectInitSkill, "utf8");
  assert.match(skillText, /formalize/);
  assert.match(skillText, /--formalize-file/);
  assert.match(skillText, /不重建專案/);
  assert.match(skillText, /不更動.*MVP.*身分與紀錄/);
  assert.match(skillText, /sync-mc/);

  const initSource = fs.readFileSync(initScript, "utf8");
  const formalizeBody = initSource.slice(
    initSource.indexOf("def formalize_project("),
    initSource.indexOf("def make_project_json("),
  );
  for (const forbiddenCall of [
    "register_quick_topology(",
    "setup_standalone_repo(",
    "rebuild_mc(",
    "SYNC_SCRIPT",
    "update_architecture(",
  ]) {
    assert.ok(!formalizeBody.includes(forbiddenCall), `formalize must not call ${forbiddenCall}`);
  }

  console.log("project-init formalize verification OK");
} finally {
  for (const fixture of fixtures) {
    fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true });
  }
}
