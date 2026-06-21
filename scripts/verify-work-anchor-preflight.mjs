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

console.log("Work-anchor preflight verification OK");
