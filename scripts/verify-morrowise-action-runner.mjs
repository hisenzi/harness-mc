import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runMorrowiseActionRunner } from "./morrowise-action-runner.mjs";

const root = path.resolve(import.meta.dirname, "..");
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morrowise-runner-"));
copyJson(
  path.join(root, "system-workflow", "registries", "morrowise-approval-policy.json"),
  path.join(tmpRoot, "system-workflow", "registries", "morrowise-approval-policy.json"),
);

const evidenceRefs = [{ type: "registry", ref: "$COLLAB/harness-mc/system-workflow/registries/morrowise-approval-policy.json" }];

const candidates = [
  candidate("rec.summary", "produce_summary", "low", false, "morrowise-proactive-loop-dashboard", { summary: "本週有 3 個 open loop。" }),
  candidate("rec.reorder", "suggest_reorder", "low", false, "morrowise-proactive-loop-dashboard", {
    project: "harness-mc",
    proposed_order_label: "MC-LIVE-20",
  }),
  candidate("rec.sync", "queue_sync_requested", "low", false, "morrowise-proactive-loop-dashboard", {
    target: "obsidian_canvas",
    project: "harness-mc",
    session_id: "verify-runner",
    created_at: "2026-06-21T09:00:00+08:00",
    sync_payload: { whiteboard: "MC 儀表版" },
  }),
  candidate("rec.patch", "draft_patch", "low", false, "morrowise-proactive-loop-dashboard", {
    patch: "*** Begin Patch\n*** Update File: example.md\n@@\n+draft only\n*** End Patch\n",
  }),
  candidate("rec.commit", "commit_now", "medium", false, "morrowise-autonomous-action-runner-v0"),
  candidate("rec.external", "request_external_write_approval", "high", true, "morrowise-approval-policy"),
];

const dryRun = runMorrowiseActionRunner({ candidates }, { root: tmpRoot, generated_at: "2026-06-21T01:00:00.000Z" });
assert.equal(dryRun.runner_id, "morrowise-action-runner.v0");
assert.equal(dryRun.mode, "dry_run_plan_only");
assert.equal(dryRun.applied_actions, 0);
assert.equal(dryRun.approval_requests, 2);
assert.equal(dryRun.outputs.find((item) => item.recommendation_id === "rec.summary").output_type, "summary");
assert.equal(dryRun.outputs.find((item) => item.recommendation_id === "rec.reorder").output_type, "reorder_suggestion");
assert.equal(dryRun.outputs.find((item) => item.recommendation_id === "rec.patch").output_type, "draft_patch");
assert.equal(dryRun.outputs.find((item) => item.recommendation_id === "rec.sync").output_type, "sync_requested_event_plan");
assert.equal(dryRun.outputs.find((item) => item.recommendation_id === "rec.commit").output_type, "approval_request");
assert.equal(dryRun.outputs.find((item) => item.recommendation_id === "rec.external").output_type, "approval_request");
assert.equal(fs.existsSync(path.join(tmpRoot, "sync-events", "pending")), false);

const appliedSync = runMorrowiseActionRunner({ candidates: [candidates[2]] }, { root: tmpRoot, writeSyncEvents: true });
assert.equal(appliedSync.mode, "low_risk_sync_queue_enabled");
assert.equal(appliedSync.applied_actions, 1);
const pendingSyncDir = path.join(tmpRoot, "sync-events", "pending");
const pendingFiles = fs.readdirSync(pendingSyncDir);
assert.equal(pendingFiles.length, 1);
const syncEvent = JSON.parse(fs.readFileSync(path.join(pendingSyncDir, pendingFiles[0]), "utf8"));
assert.equal(syncEvent.type, "sync_requested");
assert.equal(syncEvent.target, "obsidian_canvas");
assert.equal(syncEvent.project, "harness-mc");
assert.equal(syncEvent.task_id, "morrowise-proactive-loop-dashboard");

const mediumSummary = runMorrowiseActionRunner(
  { candidates: [candidate("rec.medium-summary", "produce_summary", "medium", false, "task")] },
  { root: tmpRoot },
);
assert.equal(mediumSummary.outputs[0].output_type, "approval_request");
assert.equal(mediumSummary.outputs[0].applied, false);

console.log("MorroWise action runner verification OK");

function candidate(recommendationId, suggestedAction, riskLevel, requiresApproval, suggestedTaskId, payload = {}) {
  return {
    recommendation_id: recommendationId,
    trigger_id: "morrowise.weekly_review",
    reason: `${suggestedAction} fixture`,
    suggested_action: suggestedAction,
    suggested_task_id: suggestedTaskId,
    evidence_refs: evidenceRefs,
    risk_level: riskLevel,
    requires_approval: requiresApproval,
    hc_refs: ["#risk"],
    hc_reasoning: "Fixture uses risk gate.",
    hc_confidence: 0.8,
    payload,
  };
}

function copyJson(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}
