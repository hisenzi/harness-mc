import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
execFileSync("node", ["scripts/generate-morrowise-proactive-loop.mjs"], { cwd: root, stdio: "inherit" });

const readModelPath = path.join(root, "public", "data", "morrowise-proactive-loop.json");
const mockupPath = path.join(root, "system-workflow", "docs", "mockups", "morrowise-proactive-loop.html");
const data = JSON.parse(fs.readFileSync(readModelPath, "utf8"));
const mockup = fs.readFileSync(mockupPath, "utf8");

assert.equal(data.version, 1);
assert.equal(data.read_only, true);
assert.deepEqual(data.stages, ["trigger", "recommendation", "approval", "action", "feedback"]);
assert.equal(data.summary.scenarios, 3);
assert.equal(data.summary.closed, 1);
assert.equal(data.summary.waiting_approval, 1);
assert.equal(data.summary.open_loop, 1);
assert.equal(data.summary.approval_queue, 2);
assert.equal(data.summary.runner_applied_actions, 0);
assert.ok(data.boundary.includes("cannot close tasks"));
assert.ok(data.source_of_truth.includes("$COLLAB/harness-mc/milestones/harness-mc/tasks.json"));

const requiredScenarios = new Set(["closed_loop", "waiting_approval", "runner_blocked_open_loop"]);
for (const scenario of data.scenarios) {
  requiredScenarios.delete(scenario.scenario_id);
  for (const stage of data.stages) assert.ok(scenario[stage], `${scenario.scenario_id}.${stage} missing`);
  assert.ok(scenario.recommendation.reason);
  assert.ok(Array.isArray(scenario.recommendation.evidence_refs));
  assert.ok(scenario.recommendation.evidence_refs.length > 0);
  assert.ok(["low", "medium", "high"].includes(scenario.approval.risk_level));
  assert.equal(typeof scenario.action.applied, "boolean");
  if (scenario.status !== "closed") {
    assert.equal(scenario.action.output_type, "approval_request");
    assert.equal(scenario.action.applied, false);
  }
}
assert.equal(requiredScenarios.size, 0, `missing scenarios: ${[...requiredScenarios].join(", ")}`);

for (const text of ["正常閉環", "等待審批", "runner blocked", "唯讀邊界", "觸發 → 建議 → 審批 → 動作 → 回饋"]) {
  assert.ok(mockup.includes(text), `mockup missing ${text}`);
}

console.log("MorroWise proactive loop verification OK");
