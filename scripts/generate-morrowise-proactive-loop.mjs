import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runMorrowiseActionRunner } from "./morrowise-action-runner.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const generatedAt = new Date().toISOString();
const evidenceRefs = [
  { type: "task", ref: "$COLLAB/harness-mc/milestones/harness-mc/tasks.json#morrowise-proactive-loop-dashboard" },
  { type: "registry", ref: "$COLLAB/harness-mc/system-workflow/registries/morrowise-trigger-rules.json" },
  { type: "registry", ref: "$COLLAB/harness-mc/system-workflow/registries/morrowise-recommendation-engine.json" },
  { type: "policy", ref: "$COLLAB/harness-mc/system-workflow/registries/morrowise-approval-policy.json" },
  { type: "runner", ref: "$COLLAB/harness-mc/scripts/morrowise-action-runner.mjs" },
];

const candidates = [
  {
    scenario_id: "closed_loop",
    label: "正常閉環",
    feedback_status: "closed",
    feedback_destination: "public/data/morrowise-proactive-loop.json",
    feedback_note: "Runner produced a local summary read model; no canonical task mutation or external write happened.",
    recommendation_id: "loop.weekly-review.summary",
    trigger_id: "morrowise.weekly_review",
    reason: "Sentinel heartbeat can be summarized locally so the dashboard shows the current loop without side effects.",
    suggested_action: "produce_summary",
    suggested_task_id: "morrowise-proactive-loop-dashboard",
    evidence_refs: evidenceRefs,
    risk_level: "low",
    requires_approval: false,
    hc_refs: ["#systemDynamics", "#utility"],
    hc_reasoning: "A local read model closes the observation loop while keeping tasks.json canonical.",
    hc_confidence: 0.86,
    payload: {
      summary: "Weekly review trigger produced a read-only MC summary and closed the feedback loop locally.",
    },
  },
  {
    scenario_id: "waiting_approval",
    label: "等待 Vincent approval",
    feedback_status: "waiting_approval",
    feedback_destination: "approval queue / Vincent confirmation",
    feedback_note: "External visual-layer writes stop at an approval request; the runner does not sync Heptabase or Canvas.",
    recommendation_id: "loop.visual-sync.external-approval",
    trigger_id: "morrowise.visual_sync_gap",
    reason: "Visual-layer refresh would write outside the local source of truth, so it must stop at approval.",
    suggested_action: "request_external_write_approval",
    suggested_task_id: "morrowise-approval-policy",
    evidence_refs: evidenceRefs,
    risk_level: "high",
    requires_approval: true,
    hc_refs: ["#risk", "#confirmationBias"],
    hc_reasoning: "External writes can create source-of-truth drift unless Vincent confirms the exact payload.",
    hc_confidence: 0.78,
    payload: {
      destination: "Heptabase / Obsidian Canvas",
      requested_operation: "refresh visual mirror from tasks.json",
    },
  },
  {
    scenario_id: "runner_blocked_open_loop",
    label: "runner blocked / open loop",
    feedback_status: "open_loop",
    feedback_destination: "worktree-commit confirmation gate",
    feedback_note: "Commit/push/deploy class actions are blocked by policy; runner may only produce a plan.",
    recommendation_id: "loop.commit-boundary.blocked",
    trigger_id: "morrowise.task_completed_without_state_or_commit",
    reason: "Completed work appears to need a durable git boundary, but runner cannot commit directly.",
    suggested_action: "commit_now",
    suggested_task_id: "morrowise-proactive-loop-dashboard",
    evidence_refs: evidenceRefs,
    risk_level: "medium",
    requires_approval: false,
    hc_refs: ["#risk", "#breakItDown"],
    hc_reasoning: "Separate recommendation from irreversible history mutation; route the action to worktree-commit.",
    hc_confidence: 0.82,
    payload: {
      next_gate: "worktree-commit",
      runner_limit: "commit plan only",
    },
  },
];

const runner = runMorrowiseActionRunner({ candidates }, { root, generated_at: generatedAt });

const scenarios = candidates.map((candidate) => {
  const output = runner.outputs.find((item) => item.recommendation_id === candidate.recommendation_id);
  if (!output) throw new Error(`runner output missing for ${candidate.recommendation_id}`);

  return {
    scenario_id: candidate.scenario_id,
    label: candidate.label,
    status: candidate.feedback_status,
    trigger: {
      trigger_id: candidate.trigger_id,
      risk_level: candidate.risk_level,
      source: triggerSource(candidate.trigger_id),
    },
    recommendation: {
      recommendation_id: candidate.recommendation_id,
      reason: candidate.reason,
      suggested_action: candidate.suggested_action,
      suggested_task_id: candidate.suggested_task_id,
      evidence_refs: candidate.evidence_refs,
      hc_refs: candidate.hc_refs,
      hc_reasoning: candidate.hc_reasoning,
      hc_confidence: candidate.hc_confidence,
    },
    approval: {
      requires_approval: candidate.requires_approval || output.output_type === "approval_request",
      policy: output.policy,
      risk_level: output.risk_level,
      reason: output.approval_request?.policy_reason || output.approval_request?.reason || "Allowed local read-model output.",
    },
    action: {
      runner_id: runner.runner_id,
      output_type: output.output_type,
      applied: output.applied,
      action_class: output.action_class,
      summary: output.summary || output.approval_request?.reason || output.note || null,
    },
    feedback: {
      status: candidate.feedback_status,
      destination: candidate.feedback_destination,
      note: candidate.feedback_note,
    },
    runner_output: output,
  };
});

const data = {
  version: 1,
  generated_at: generatedAt,
  read_only: true,
  source_of_truth: [
    "$COLLAB/harness-mc/milestones/harness-mc/tasks.json",
    "$COLLAB/harness-mc/task-events",
    "$COLLAB/harness-mc/sync-events",
    "$COLLAB/harness-mc/system-workflow/registries/morrowise-approval-policy.json",
  ],
  boundary: "Dashboard displays proactive loop status only. It cannot close tasks, commit, push, deploy, write external systems, or reverse-write from visual layers.",
  stages: ["trigger", "recommendation", "approval", "action", "feedback"],
  summary: {
    scenarios: scenarios.length,
    closed: scenarios.filter((item) => item.status === "closed").length,
    waiting_approval: scenarios.filter((item) => item.status === "waiting_approval").length,
    open_loop: scenarios.filter((item) => item.status === "open_loop").length,
    approval_queue: runner.approval_requests,
    runner_applied_actions: runner.applied_actions,
  },
  runner,
  scenarios,
};

const outPath = path.join(root, "public", "data", "morrowise-proactive-loop.json");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(data, null, 2)}\n`);
console.log(`Wrote ${path.relative(root, outPath)}`);

function triggerSource(triggerId) {
  if (triggerId === "morrowise.weekly_review") return "$COLLAB/harness-mc/public/data/changes.json";
  if (triggerId === "morrowise.visual_sync_gap") return "$COLLAB/harness-mc/public/data/projects.json";
  if (triggerId === "morrowise.task_completed_without_state_or_commit") return "$COLLAB/harness-mc/public/data/worktrees.json";
  return "$COLLAB/harness-mc/system-workflow/registries/morrowise-trigger-rules.json";
}
