#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { sortTasksByPlan } from "../lib/taskOrdering.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const initScript = path.join(root, "scripts", "new-project.py");

function runInit(extraArgs = []) {
  return spawnSync(
    "python3",
    [
      initScript,
      "--id",
      "project-init-fixture",
      "--name",
      "開案契約驗證",
      "--desc",
      "驗證成果契約與分類欄位。",
      "--type",
      "internal",
      "--problem",
      "開案時沒有可追溯的問題與量化目標。",
      "--impact",
      "避免建立無法驗收或無法排序的專案。",
      "--metric",
      "具成果契約的專案比例",
      "--baseline",
      "0%",
      "--target",
      "100%",
      "--due",
      "2026-08-31",
      "--measurement-source",
      "node scripts/verify-project-init-v1.mjs",
      "--dry-run",
      ...extraArgs,
    ],
    { cwd: root, encoding: "utf8" },
  );
}

const valid = runInit();
assert.equal(valid.status, 0, valid.stderr);
const preview = JSON.parse(valid.stdout);
assert.deepEqual(preview.project.outcome, {
  problem_statement: "開案時沒有可追溯的問題與量化目標。",
  impact: "避免建立無法驗收或無法排序的專案。",
  success_target: {
    metric: "具成果契約的專案比例",
    baseline: "0%",
    target: "100%",
    due: "2026-08-31",
  },
  measurement_source: "node scripts/verify-project-init-v1.mjs",
});
assert.equal(preview.project.task_taxonomy.sort_rule, "dependencies_then_priority_then_id");
assert.ok(preview.tasks.tasks.every((task) => task.capability_domain && task.task_kind && task.priority));

const placeholder = runInit(["--target", "（請填入目標）"]);
assert.notEqual(placeholder.status, 0, "placeholder target must be rejected");

const ordered = sortTasksByPlan([
  { id: "follow-up", priority: "P0", dependencies: ["foundation"] },
  { id: "foundation", priority: "P2", dependencies: [] },
  { id: "urgent-independent", priority: "P0", dependencies: [] },
]);
assert.deepEqual(
  ordered.map((task) => task.id),
  ["urgent-independent", "foundation", "follow-up"],
  "ready tasks sort by priority/id, while dependencies always precede their dependents",
);

const mapPath = path.join(root, "milestones", "morrowise", "maps", "operating-loop.json");
const operatingMap = JSON.parse(fs.readFileSync(mapPath, "utf8"));
assert.equal(operatingMap.kind, "operating-loop");
assert.equal(operatingMap.nodes.length, 11, "Operating Loop Map must retain the 10 domains plus verification");
assert.ok(operatingMap.nodes.every((node) => node.as_of && node.evidence_refs?.length > 0));
assert.ok(operatingMap.relationships.some((edge) => edge.type === "guard"));

const projectsPage = fs.readFileSync(path.join(root, "app", "projects", "page.tsx"), "utf8");
assert.match(projectsPage, /sortTasksByPlan/);
assert.match(projectsPage, /project_map/);

console.log("project-init v1 verification OK");
