import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

execFileSync(process.execPath, [path.join(root, "scripts", "generate-data.mjs")], {
  cwd: root,
  stdio: "pipe",
});

const taxonomy = readJson(path.join(root, "system-workflow", "registries", "pai-domain-taxonomy.json"));
const projects = readJson(path.join(root, "public", "data", "projects.json"));
const projectsPage = fs.readFileSync(path.join(root, "app", "projects", "page.tsx"), "utf-8");
const harnessTasks = readJson(path.join(root, "milestones", "harness-mc", "tasks.json")).tasks;
const expectedProjectIds = [
  "english-for-future-work",
  "house123-buy",
  "market-watchtower",
  "notion-finance",
  "organizing-photos",
  "self-learning",
  "travel-finance-dashboard",
  "wealth-system",
];

test("Life-Focus remains the internal id while Future Practice is the displayed name", () => {
  const domain = taxonomy.domains.find((item) => item.id === "Life-Focus");
  assert.ok(domain, "Life-Focus domain id must remain available for compatibility");
  assert.equal(domain.label, "Future Practice｜未來練習");

  const mappedProjects = projects.filter((project) => project.domain === "Life-Focus");
  assert.deepEqual(
    mappedProjects.map((project) => project.project).sort(),
    expectedProjectIds,
    "the existing seven Life-Focus project mappings must remain intact",
  );
  for (const project of mappedProjects) {
    assert.equal(project.domainLabel, "Future Practice｜未來練習");
  }
});

test("the finance pilot keeps stable canonical and output references in generated project data", () => {
  const selfLearning = projects.find((project) => project.project === "self-learning");
  assert.ok(selfLearning, "self-learning must remain in projects.json");

  const pilot = selfLearning.tasks.find((task) => task.id === "future-practice-finance-pilot-v1");
  assert.ok(pilot, "the approved finance pilot task must be generated");
  assert.equal(pilot.canonical_ref, "self-learning/future-practice-finance-pilot-v1");
  assert.equal(pilot.output_ref, "wealth-system/b-6");

  const wealthSystem = projects.find((project) => project.project === "wealth-system");
  assert.ok(wealthSystem?.tasks.some((task) => task.id === "b-6"), "the finance output target must exist");
});

test("the existing projects surface renders the output reference without adding a new route", () => {
  assert.match(projectsPage, /輸出：\s*\{task\.output_ref\}/s);

  const dedicatedPages = walkFiles(path.join(root, "app"))
    .filter((filePath) => path.basename(filePath) === "page.tsx")
    .map((filePath) => path.relative(path.join(root, "app"), filePath))
    .filter((routePath) => /future[-_]?practice/i.test(routePath));
  assert.deepEqual(dedicatedPages, [], "Future Practice must not introduce a dedicated app route");

  const dedicatedReadModels = fs.readdirSync(path.join(root, "public", "data"))
    .filter((fileName) => /future[-_]?practice/i.test(fileName));
  assert.deepEqual(dedicatedReadModels, [], "Future Practice must not introduce a dedicated read model");
});

test("the domain tracking support task closes after its build blockers are resolved", () => {
  const supportTask = harnessTasks.find((task) => task.id === "future-practice-domain-tracking-v1");
  assert.ok(supportTask, "the approved support task must remain canonical");
  assert.equal(supportTask.status, "completed");
  assert.equal(supportTask.completed_at, "2026-07-26");
  assert.match(supportTask.summary, /完整 npm production build 已通過/);
});

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8").replace(/^﻿/, ""));
}

function walkFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(entryPath) : [entryPath];
  });
}
