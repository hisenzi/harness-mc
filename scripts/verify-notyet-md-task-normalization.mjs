import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const project = readJson("milestones/notyet-md/project.json");
const canonical = readJson("milestones/notyet-md/tasks.json");
const generated = readJson("public/data/projects.json");
const tasksById = new Map(canonical.tasks.map((task) => [task.id, task]));
const generatedProject = generated.find((entry) => entry.project === "notyet-md");
const doneStatuses = new Set(["done", "completed"]);

assert.equal(canonical.tasks.length, 16, "notyet.md canonical task total must remain 16");
assert.equal(
  canonical.tasks.filter((task) => doneStatuses.has(task.status)).length,
  11,
  "notyet.md completed task total must remain 11",
);
assert.equal(project.tracks["p1-lineage"], "P1｜方法實證與文章歷程");
assert.match(project.tracks["p2-hiblocks"], /^未來候選｜/);
assert.match(project.tracks["p3-cms"], /^未來候選｜/);

for (const id of ["p0-9", "p1-1", "practice-impact-article-lineage-surface-v1"]) {
  const task = requireTask(id);
  assert.equal(task.status, "todo", `${id} must remain active todo`);
  assertExecutionContract(task);
}

for (const id of ["p2-1", "p3-1"]) {
  const task = requireTask(id);
  assert.equal(task.status, "deferred", `${id} must be a deferred future candidate`);
  assert.equal(task.progress_scope, "future_candidate");
  assert.match(task.admission_gate, /\S/);
  assertExecutionContract(task);
  assert.equal(task.task_lifecycle.history.at(-1).operation, "suspend");
  assert.match(task.task_lifecycle.history.at(-1).reactivation_criteria, /\S/);
}

const releaseTask = requireTask("p0-9");
assert.doesNotMatch(releaseTask.title, /^commit \+ push \+/);
assert.ok(
  releaseTask.acceptance.some((item) => /commit、push、deploy 與 DNS.*獨立核准/.test(item)),
  "p0-9 must preserve independent approval gates",
);

const styleTask = requireTask("p1-1");
assert.ok(styleTask.acceptance.length >= 4, "p1-1 must have a measurable acceptance matrix");
assert.ok(
  styleTask.execution_contract.verifiers.includes("npm run build"),
  "p1-1 must require a fresh build",
);

const legacyTask = requireTask("open-project");
assert.equal(legacyTask.status, "done", "legacy task must not be reopened");
assert.match(legacyTask.done_condition, /\S/, "legacy task done_condition must be backfilled");
assert.equal(legacyTask.task_lifecycle.history.at(-1).operation, "amend");

const lineageTask = requireTask("practice-impact-article-lineage-surface-v1");
assert.ok(
  lineageTask.dependencies.includes("morrowise/practice-adoption-evidence-read-model-v1"),
  "lineage task must explicitly depend on its MorroWise producer",
);

assert.ok(generatedProject, "notyet.md generated project must exist");
assert.equal(generatedProject.done, 11, "dashboard mirror must display 11 completed tasks");
assert.equal(generatedProject.total, 16, "dashboard mirror must display 16 total tasks");
assert.equal(generatedProject.tracks["p1-lineage"], "P1｜方法實證與文章歷程");
assert.match(generatedProject.tracks["p2-hiblocks"], /^未來候選｜/);
assert.match(generatedProject.tracks["p3-cms"], /^未來候選｜/);
assert.deepEqual(
  generatedProject.tasks
    .filter((task) => task.track === "p1-lineage")
    .map((task) => task.status),
  ["todo"],
  "dashboard mirror must display p1-lineage as 0/1",
);
assert.deepEqual(
  generatedProject.tasks
    .filter((task) => ["p2-hiblocks", "p3-cms"].includes(task.track))
    .map((task) => task.status)
    .sort(),
  ["deferred", "deferred"],
  "dashboard mirror must list future candidates separately as deferred",
);

console.log("notyet.md task normalization verification passed");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), "utf8"));
}

function requireTask(id) {
  const task = tasksById.get(id);
  assert.ok(task, `missing canonical task: ${id}`);
  return task;
}

function assertExecutionContract(task) {
  assert.ok(Array.isArray(task.dependencies) && task.dependencies.length > 0, `${task.id} dependencies must be explicit`);
  assert.match(task.review_date, /^\d{4}-\d{2}-\d{2}$/, `${task.id} review_date must be explicit`);
  assert.match(task.execution_contract?.owner, /\S/, `${task.id} owner must be explicit`);
  assert.match(task.execution_contract?.source_of_truth, /\S/, `${task.id} source_of_truth must be explicit`);
  assert.ok(task.execution_contract?.inputs?.length > 0, `${task.id} inputs must be explicit`);
  assert.ok(task.execution_contract?.outputs?.length > 0, `${task.id} outputs must be explicit`);
  assert.ok(task.execution_contract?.verifiers?.length > 0, `${task.id} verifiers must be explicit`);
  assert.match(task.execution_contract?.stop_condition, /\S/, `${task.id} stop_condition must be explicit`);
}
