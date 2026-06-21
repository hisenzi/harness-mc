#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const collabRoot = path.resolve(root, "..");
const notyetRoot = path.join(collabRoot, "notyet-harness");

function readNotyet(relativePath) {
  return readFileSync(path.join(notyetRoot, relativePath), "utf8");
}

function run(args) {
  return execFileSync(process.execPath, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

const planning = readNotyet("000_Agent/skills/vincent-superpowers/02-planning/SKILL.md");
const execution = readNotyet("000_Agent/skills/vincent-superpowers/03-execution/SKILL.md");
const projectInit = readNotyet("000_Agent/skills/project-init/SKILL.md");
const tasks = JSON.parse(readFileSync(path.join(root, "milestones/harness-mc/tasks.json"), "utf8")).tasks;
const gateTask = tasks.find((task) => task.id === "acp-hc-framing-gate");

assert(gateTask, "ACP-MC-GATE-05 task must exist");
assert.equal(gateTask.order_label, "ACP-MC-GATE-05");
assert(["in_progress", "completed"].includes(gateTask.status), "ACP-MC-GATE-05 must be in_progress or completed");
assert(gateTask.hc_decision, "ACP-MC-GATE-05 must carry its own hc_decision");
assert.deepEqual(gateTask.hc_decision.hc_refs, ["#rightProblem", "#systemDynamics", "#risk", "#confirmationBias"]);
assert.match(gateTask.hc_decision.source_boundary, /thinking check/i);
assert.match(gateTask.hc_decision.source_boundary, /source of truth/i);

for (const [name, content] of [
  ["planning", planning],
  ["execution", execution],
  ["project-init", projectInit],
]) {
  assert.match(content, /HC decision block/, `${name} must mention HC decision block`);
  assert.match(content, /not_required_reason/, `${name} must document not_required_reason fallback`);
  assert.match(content, /thinking check/i, `${name} must say HC is a thinking check`);
  assert.match(content, /source of truth/i, `${name} must preserve source-of-truth boundary`);
}

assert.match(planning, /version: 1\.8/, "planning skill version must include HC gate");
assert.match(execution, /version: 1\.4/, "execution skill version must include HC gate");
assert.match(projectInit, /version: 3\.9/, "project-init skill version must include HC gate");

if (gateTask.status !== "completed") {
  const preflight = run([
    "scripts/work-anchor-preflight.mjs",
    "--project",
    "harness-mc",
    "--task-id",
    "acp-hc-framing-gate",
    "--intent",
    "進行 ACP-MC-GATE-05",
    "--json",
  ]);
  const preflightResult = JSON.parse(preflight);
  assert.equal(preflightResult.decision, "allow");
  assert.equal(preflightResult.hc_gate.decision, "allow");
  assert.equal(preflightResult.hc_gate.task_scope, "harness-mc/acp-hc-framing-gate");
}

run(["scripts/verify-work-anchor-preflight.mjs"]);
run(["scripts/verify-validate-tasks.mjs"]);

console.log("HC framing gate verification passed");
