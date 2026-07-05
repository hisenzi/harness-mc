import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { formatMarkdown, runPreflight } from "./work-anchor-preflight.mjs";

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
const missingHcMarkdown = formatMarkdown(missingHcResult);
assert.match(missingHcMarkdown, /blocked reason: HC decision block is required/);
assert.match(missingHcMarkdown, /required fields: task_scope/);
assert.doesNotMatch(missingHcMarkdown, /proposed task:/);

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
assert.equal(withHcResult.event_gate, null, "without --event the gate must not activate (no startup burden)");

// JV-17 事件點 gate：dispatch 缺三件套 → blocked，缺件逐項點名
const dispatchMissing = runPreflight({
  project: "harness-mc",
  tasks: withHcFixturePath,
  taskId: "acp-work-anchor-preflight-flow",
  intent: "派工 fixture",
  event: "dispatch",
  proposedAcceptance: [],
});
assert.equal(dispatchMissing.decision, "blocked");
assert.equal(dispatchMissing.event_gate.decision, "blocked");
const failingIds = dispatchMissing.event_gate.checklist.filter((item) => !item.ok).map((item) => item.id);
assert.deepEqual(failingIds, ["write_boundary", "report_format", "model_tier", "verify_plan"]);
assert.match(dispatchMissing.blocked_reason, /不給三件套就派工 = 違規/);
assert.match(
  dispatchMissing.event_gate.checklist.find((item) => item.id === "report_format").ref,
  /model-dispatch-contract\.md#2/,
);
assert.match(dispatchMissing.event_gate.watch_signals.stop_signals, /judgment-externalization-matrix\.md#第一類/);
const dispatchMarkdown = formatMarkdown(dispatchMissing);
assert.match(dispatchMarkdown, /事件點 gate（dispatch）: blocked/);
assert.match(dispatchMarkdown, /\[ \] write_boundary/);

// JV-17：dispatch 三件套＋分級＋驗證計畫齊 → allow
const dispatchReady = runPreflight({
  project: "harness-mc",
  tasks: withHcFixturePath,
  taskId: "acp-work-anchor-preflight-flow",
  intent: "派工 fixture",
  event: "dispatch",
  scope: ["scripts/foo.mjs", "milestones/harness-mc/tasks.json"],
  template: "模板4-審查",
  modelTier: "sonnet",
  verifyPlan: "npm run test:tasks + fresh-context read-back",
  proposedAcceptance: [],
});
assert.equal(dispatchReady.decision, "allow");
assert.equal(dispatchReady.event_gate.decision, "allow");
assert.ok(dispatchReady.event_gate.checklist.every((item) => item.ok));

// JV-17：implementation 只要求 anchor + HC + 可寫邊界
const implReady = runPreflight({
  project: "harness-mc",
  tasks: withHcFixturePath,
  taskId: "acp-work-anchor-preflight-flow",
  intent: "實作 fixture",
  event: "implementation",
  scope: ["scripts/foo.mjs"],
  proposedAcceptance: [],
});
assert.equal(implReady.decision, "allow");
assert.equal(implReady.event_gate.checklist.length, 3, "implementation event must not demand dispatch-only items");

const implMissingScope = runPreflight({
  project: "harness-mc",
  tasks: withHcFixturePath,
  taskId: "acp-work-anchor-preflight-flow",
  intent: "實作 fixture",
  event: "implementation",
  proposedAcceptance: [],
});
assert.equal(implMissingScope.decision, "blocked");
assert.deepEqual(
  implMissingScope.event_gate.checklist.filter((item) => !item.ok).map((item) => item.id),
  ["write_boundary"],
);

console.log("Work-anchor preflight verification OK");
