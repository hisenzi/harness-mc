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

// 版本用數值下限比較（HC gate 引入版），不用 exact pin——skill 例行升版不應弄壞本 verifier
// （2026-07-05：project-init 3.9→3.10 讓 exact pin 假紅，與寫死 task id 同型自腐）
assertVersionAtLeast(planning, "planning", "1.8");
assertVersionAtLeast(execution, "execution", "1.4");
assertVersionAtLeast(projectInit, "project-init", "3.9");

function assertVersionAtLeast(content, name, minimum) {
  const match = content.match(/version:\s*"?(\d+)\.(\d+)/);
  assert(match, `${name} skill must declare a version`);
  const [major, minor] = [Number(match[1]), Number(match[2])];
  const [minMajor, minMinor] = minimum.split(".").map(Number);
  assert(
    major > minMajor || (major === minMajor && minor >= minMinor),
    `${name} skill version ${major}.${minor} predates the HC gate (needs >= ${minimum})`,
  );
}

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
