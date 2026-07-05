import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { processPulseProposals, PROPOSAL_TTL_DAYS, QUEUE_SOFT_CAP, DAILY_RED_PUSH_CAP } from "./pulse-proposal-queue.mjs";

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pulse-proposals."));
}

function degradedReport(steps) {
  return { status: "degraded", steps, next_action: { target: "fix-something" }, summary: { failed: steps.length, total: 10 } };
}

const failStep = (id, stderr = "boom") => ({ id, status: "fail", command: id, stderr_excerpt: stderr, stdout_excerpt: "" });

// 1. 新 failure → amber proposal 入佇列，read model 齊 envelope
{
  const root = tmpRoot();
  const result = processPulseProposals({ root, report: degradedReport([failStep("npm:test-x")]), now: "2026-07-01T00:00:00Z" });
  assert.equal(result.created.length, 1);
  assert.equal(result.created[0].severity, "amber");
  assert.equal(result.created[0].status, "pending_decision");
  assert.ok(fs.existsSync(path.join(root, "task-proposals", "pending", "pulse-npm-test-x.json")));
  assert.ok(fs.existsSync(path.join(root, "public", "data", "pulse-proposals.json")));
  assert.equal(result.pushMessage, null, "amber alone must not push");
  for (const key of ["schema_version", "generated_at", "read_only", "source_of_truth", "generator", "stale_rule", "counts", "oldest_pending_days", "proposals", "next_action", "write_boundary", "verifier_ref"]) {
    assert.ok(Object.hasOwn(result.readModel, key), `read model missing ${key}`);
  }
  assert.ok(result.created[0].source_boundary.includes("非 task 正本"), "source boundary must be explicit");
  fs.rmSync(root, { recursive: true, force: true });
}

// 2. S4 兩輪失敗：同一 step 第二次 → amber 升 red，且 red 推播
{
  const root = tmpRoot();
  processPulseProposals({ root, report: degradedReport([failStep("npm:test-x")]), now: "2026-07-01T00:00:00Z" });
  const second = processPulseProposals({ root, report: degradedReport([failStep("npm:test-x")]), now: "2026-07-02T00:00:00Z" });
  assert.equal(second.escalated.length, 1);
  assert.equal(second.escalated[0].severity, "red");
  assert.equal(second.escalated[0].occurrences, 2);
  assert.ok(second.escalated[0].triage_refs.some((ref) => ref.endsWith("#S4")), "escalation must cite S4");
  assert.ok(second.pushMessage, "escalated red must push");
  fs.rmSync(root, { recursive: true, force: true });
}

// 3. sync:* --check drift → auto_fixable（approval-policy allowed tier），不推播
{
  const root = tmpRoot();
  const step = { id: "sync:morrowise-manual", status: "fail", command: "python3 sync-morrowise-manual.py --check", stderr_excerpt: "drift", stdout_excerpt: "" };
  const result = processPulseProposals({ root, report: degradedReport([step]), now: "2026-07-01T00:00:00Z" });
  assert.equal(result.created[0].severity, "auto_fixable");
  assert.ok(result.created[0].triage_refs.some((ref) => ref.includes("approval-policy")), "auto_fixable must cite allowed tier");
  assert.equal(result.pushMessage, null);
  fs.rmSync(root, { recursive: true, force: true });
}

// 4. Vincent 裁決類（pending gate）→ red 即推，引 E 類熔斷
{
  const root = tmpRoot();
  const step = failStep("task-events:pending-gate", "5 pending; Vincent should decide");
  const result = processPulseProposals({ root, report: degradedReport([step]), now: "2026-07-01T00:00:00Z" });
  assert.equal(result.created[0].severity, "red");
  assert.ok(result.created[0].triage_refs.some((ref) => ref.includes("第三類")), "red must cite escalation class");
  assert.ok(result.pushMessage.includes("red 1 則"));
  fs.rmSync(root, { recursive: true, force: true });
}

// 5. TTL：pending 超過 7 天未裁決 → degraded_to_weekly（healthy run 也要 sweep）
{
  const root = tmpRoot();
  processPulseProposals({ root, report: degradedReport([failStep("npm:test-old")]), now: "2026-07-01T00:00:00Z" });
  const later = new Date(`2026-07-0${1 + 0}T00:00:00Z`);
  later.setUTCDate(later.getUTCDate() + PROPOSAL_TTL_DAYS + 1);
  const sweep = processPulseProposals({ root, report: null, now: later.toISOString() });
  const swept = sweep.proposals.find((proposal) => proposal.proposal_id === "pulse-npm-test-old");
  assert.equal(swept.status, "degraded_to_weekly");
  assert.equal(sweep.readModel.counts.degraded_to_weekly, 1);
  assert.equal(sweep.readModel.counts.pending_decision, 0);
  fs.rmSync(root, { recursive: true, force: true });
}

// 6. 佇列上限：pending_decision > cap → 佇列自身 red overload proposal
{
  const root = tmpRoot();
  const steps = Array.from({ length: QUEUE_SOFT_CAP + 1 }, (_, index) => failStep(`npm:test-${index}`));
  const result = processPulseProposals({ root, report: degradedReport(steps), now: "2026-07-01T00:00:00Z" });
  const overload = result.proposals.find((proposal) => proposal.proposal_id === "queue-overload");
  assert.ok(overload, "overload proposal must be created");
  assert.equal(overload.severity, "red");
  fs.rmSync(root, { recursive: true, force: true });
}

// 7. 每日 red 推播 ≤3：超過自動合併為一則
{
  const root = tmpRoot();
  const steps = Array.from({ length: 5 }, (_, index) => failStep(`gate-${index}`, "needs Vincent decision"));
  const result = processPulseProposals({ root, report: degradedReport(steps), now: "2026-07-01T00:00:00Z" });
  assert.ok(result.pushMessage.includes("已合併"), "over-cap reds must merge");
  const bulletLines = result.pushMessage.split("\n").filter((line) => line.startsWith("·"));
  assert.equal(bulletLines.length, DAILY_RED_PUSH_CAP);
  fs.rmSync(root, { recursive: true, force: true });
}

// 8. 冪等：同日重跑同 report 不重複建檔（occurrences 遞增而非新 proposal）
{
  const root = tmpRoot();
  processPulseProposals({ root, report: degradedReport([failStep("npm:test-x")]), now: "2026-07-01T00:00:00Z" });
  const rerun = processPulseProposals({ root, report: degradedReport([failStep("npm:test-x")]), now: "2026-07-01T01:00:00Z" });
  assert.equal(rerun.created.length, 0);
  const files = fs.readdirSync(path.join(root, "task-proposals", "pending"));
  assert.equal(files.length, 1);
  fs.rmSync(root, { recursive: true, force: true });
}

// 9. 恢復自動結案：step 轉 pass → proposal 移 resolved/，pending 清空
{
  const root = tmpRoot();
  processPulseProposals({ root, report: degradedReport([failStep("npm:test-x")]), now: "2026-07-01T00:00:00Z" });
  const recoveredReport = {
    status: "degraded",
    steps: [{ id: "npm:test-x", status: "pass" }, failStep("npm:test-y")],
    next_action: { target: "fix-y" },
    summary: { failed: 1, total: 10 },
  };
  const result = processPulseProposals({ root, report: recoveredReport, now: "2026-07-02T00:00:00Z" });
  assert.equal(result.resolved.length, 1);
  assert.equal(result.resolved[0].resolved.reason, "step_recovered");
  assert.ok(fs.existsSync(path.join(root, "task-proposals", "resolved", "pulse-npm-test-x.json")));
  assert.ok(!fs.existsSync(path.join(root, "task-proposals", "pending", "pulse-npm-test-x.json")));
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("pulse proposal queue verification OK — 9 cases");
