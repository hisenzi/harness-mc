import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runPreflight } from "./work-anchor-preflight.mjs";

const root = path.resolve(import.meta.dirname, "..");

const allowResult = runPreflight({
  project: "house123-buy",
  tasks: path.join(root, "milestones", "house123-buy", "tasks.json"),
  intent: "開始",
  proposedAcceptance: [],
});

assert.equal(allowResult.decision, "allow");
assert.equal(allowResult.active_task.id, "post-approval-loan-strategy-simulator");
assert.equal(allowResult.existing_task_state.active, 1);

const original = JSON.parse(
  fs.readFileSync(path.join(root, "milestones", "house123-buy", "tasks.json"), "utf-8"),
);
const historicalFixture = {
  tasks: original.tasks.filter((task) => task.id !== "post-approval-loan-strategy-simulator"),
};
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "work-anchor-preflight-"));
const fixturePath = path.join(tmpDir, "tasks.json");
fs.writeFileSync(fixturePath, JSON.stringify(historicalFixture, null, 2), "utf-8");

const blockedResult = runPreflight({
  project: "house123-buy",
  tasks: fixturePath,
  intent: "可以",
  proposedId: "post-approval-loan-strategy-simulator",
  proposedTitle: "核貸後決策系統：核准條件試算 + 四軸風險評分 + 推薦方案",
  proposedTrack: "dev",
  proposedDoneCondition: "新增核貸後決策流程，並把試算、風險評分、推薦方案整合到摘要/PDF。",
  proposedAcceptance: [
    "列出核准條件輸入、月付/總利息試算、四軸風險評分與推薦方案。",
  ],
});

assert.equal(blockedResult.decision, "blocked");
assert.equal(blockedResult.existing_task_state.active, 0);
assert.equal(blockedResult.existing_task_state.done, historicalFixture.tasks.length);
assert.equal(blockedResult.proposed_task.complete, true);
assert.equal(blockedResult.proposed_task.task.id, "post-approval-loan-strategy-simulator");
assert.match(blockedResult.next_required_step, /確認 proposed task/);
assert.match(blockedResult.next_required_step, /開始改檔/);
assert.equal(
  "active_task" in blockedResult && blockedResult.active_task === null,
  true,
  "blocked preflight must not expose an active task that would allow implementation",
);

const hcFixturePath = path.join(tmpDir, "hc-gate-tasks.json");
fs.writeFileSync(
  hcFixturePath,
  JSON.stringify({
    tasks: [
      {
        id: "acp-work-anchor-preflight-flow",
        title: "ACP-MC-GATE-03 fixture missing HC decision",
        status: "todo",
        track: "control-plane",
        order_label: "ACP-MC-GATE-03",
        done_condition: "Fixture should not enter implementation before HC framing.",
      },
    ],
  }, null, 2),
  "utf-8",
);

const missingHcResult = runPreflight({
  project: "harness-mc",
  tasks: hcFixturePath,
  taskId: "acp-work-anchor-preflight-flow",
  intent: "進行 ACP-MC-GATE-03 fixture",
  proposedAcceptance: [],
});

assert.equal(missingHcResult.decision, "blocked");
assert.equal(missingHcResult.active_task.id, "acp-work-anchor-preflight-flow");
assert.equal(missingHcResult.hc_gate.required, true);
assert.match(missingHcResult.blocked_reason, /HC decision block is required/);
assert.match(missingHcResult.next_required_step, /HC decision block/);
assert.match(missingHcResult.next_required_step, /implementation flow/);

const withHcFixturePath = path.join(tmpDir, "hc-gate-ready-tasks.json");
fs.writeFileSync(
  withHcFixturePath,
  JSON.stringify({
    tasks: [
      {
        id: "acp-work-anchor-preflight-flow",
        title: "ACP-MC-GATE-03 fixture with HC decision",
        status: "todo",
        track: "control-plane",
        order_label: "ACP-MC-GATE-03",
        done_condition: "Fixture may enter execution after HC framing.",
        hc_decision: {
          task_scope: "harness-mc/acp-work-anchor-preflight-flow",
          hc_refs: ["#rightProblem", "#risk"],
          hc_reasoning: "Fixture confirms HC framing happens before implementation.",
          hc_confidence: 0.8,
          evidence_refs: ["milestones/harness-mc/tasks.json"],
          source_boundary: "HC is a thinking check, not source of truth; tasks.json remains canonical.",
        },
      },
    ],
  }, null, 2),
  "utf-8",
);

const withHcResult = runPreflight({
  project: "harness-mc",
  tasks: withHcFixturePath,
  taskId: "acp-work-anchor-preflight-flow",
  intent: "進行 ACP-MC-GATE-03 fixture",
  proposedAcceptance: [],
});

assert.equal(withHcResult.decision, "allow");
assert.equal(withHcResult.hc_gate.decision, "allow");
assert.equal(withHcResult.hc_gate.task_scope, "harness-mc/acp-work-anchor-preflight-flow");

console.log("Work-anchor preflight verification OK");
