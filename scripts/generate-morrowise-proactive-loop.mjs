import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runMorrowiseActionRunner } from "./morrowise-action-runner.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const selfLearningProjectPath = path.join(root, "milestones", "self-learning", "project.json");
const selfLearningTasksPath = path.join(root, "milestones", "self-learning", "tasks.json");
const selfLearningProject = readJson(selfLearningProjectPath);
const selfLearningTasks = readJson(selfLearningTasksPath).tasks || [];
const selfLearningGoalFingerprint = `sha256:${crypto.createHash("sha256").update(JSON.stringify(selfLearningProject.goals)).digest("hex")}`;
const hasTwentyYearAnchor = JSON.stringify(selfLearningProject.goals).includes("二十年定錨");
const openStatuses = new Set(["todo", "not_started", "in_progress", "doing", "blocked"]);
const selfLearningOpenTasks = selfLearningTasks.filter((task) => openStatuses.has(task.status));

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
  {
    scenario_id: "self_learning_read_only_dogfood",
    label: "self-learning 唯讀治理驗證",
    feedback_status: "waiting_approval",
    feedback_destination: "Vincent approval / item 1 canonical goal anchor",
    feedback_note: "MorroWise identified a goal-anchor gap and stopped at a proposal; self-learning canonical project and tasks remain unchanged.",
    candidate_type: "propose_next_task",
    recommendation_id: "loop.task-governance.self-learning.goal-anchor-gap",
    trigger_id: "morrowise.weekly_review",
    reason: "Task reorganization cannot be evidence-safe until the approved twenty-year anchor is written to the self-learning canonical project source.",
    suggested_action: "propose_next_task",
    suggested_task_id: "pending-vincent-approved-item-1-task-id",
    target_project: "self-learning",
    target_task_source: "$COLLAB/harness-mc/milestones/self-learning/tasks.json",
    goal_ref: "$COLLAB/harness-mc/milestones/self-learning/project.json#/goals",
    goal_fingerprint: selfLearningGoalFingerprint,
    source_task_refs: [
      "self-learning/future-practice-finance-pilot-v1",
      "morrowise/task-lifecycle-jv32-gate",
    ],
    evidence_refs: [
      { type: "canonical_project", ref: "$COLLAB/harness-mc/milestones/self-learning/project.json" },
      { type: "canonical_tasks", ref: "$COLLAB/harness-mc/milestones/self-learning/tasks.json" },
      { type: "acceptance_matrix", ref: "$COLLAB/harness-mc/milestones/morrowise/tasks.json#task-lifecycle-jv32-gate.acceptance_matrix" },
    ],
    observed_gap: hasTwentyYearAnchor
      ? "The canonical anchor exists; item 1 may now define the proposed task scope with Vincent."
      : "The current self-learning project goals do not yet contain the approved twenty-year anchor.",
    proposed_operation: "blocked",
    proposed_done_condition: "Vincent approves item 1 and its canonical self-learning goal anchor before MorroWise proposes any task reorganization.",
    limitations: [
      "Canonical twenty-year anchor（正式二十年定錨目標）尚未由 item 1 寫入 self-learning project source.",
      "Read-only dogfood: this candidate does not create, amend, reorder, defer, cancel, or replace a self-learning task.",
    ],
    risk_level: "medium",
    requires_approval: true,
    hc_refs: ["#rightProblem", "#systemDynamics", "#risk"],
    hc_reasoning: "Keep the goal anchor, task mutation, and evidence loop ordered; missing canonical evidence must block rather than invent a task.",
    hc_confidence: 0.94,
    payload: {
      project: "self-learning",
      target_project_path: selfLearningProjectPath,
      target_tasks_path: selfLearningTasksPath,
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
      ...(candidate.candidate_type ? {
        task_governance: {
          candidate_type: candidate.candidate_type,
          target_project: candidate.target_project,
          target_task_source: candidate.target_task_source,
          goal_ref: candidate.goal_ref,
          goal_fingerprint: candidate.goal_fingerprint,
          source_task_refs: candidate.source_task_refs,
          evidence_refs: candidate.evidence_refs,
          observed_gap: candidate.observed_gap,
          proposed_operation: candidate.proposed_operation,
          proposed_done_condition: candidate.proposed_done_condition,
          limitations: candidate.limitations,
          requires_approval: candidate.requires_approval,
        },
      } : {}),
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
    "$COLLAB/harness-mc/milestones/self-learning/project.json",
    "$COLLAB/harness-mc/milestones/self-learning/tasks.json",
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
  goal_drift_review: {
    target_project: "self-learning",
    target_task_source: "$COLLAB/harness-mc/milestones/self-learning/tasks.json",
    goal_ref: "$COLLAB/harness-mc/milestones/self-learning/project.json#/goals",
    status: hasTwentyYearAnchor ? "review_required" : "blocked_missing_canonical_anchor",
    current_goal_fingerprint: selfLearningGoalFingerprint,
    reviewed_goal_fingerprint: null,
    open_task_ids: selfLearningOpenTasks.map((task) => task.id),
    proposals: selfLearningOpenTasks.map((task) => ({
      task_id: task.id,
      source_task_ref: `self-learning/${task.id}`,
      proposed_operation: "blocked",
      reason: hasTwentyYearAnchor
        ? "The canonical anchor exists, but fresh task-level contribution evidence has not yet been reviewed."
        : "The canonical twenty-year anchor is missing, so no retain/amend/defer/cancel/replace judgment is evidence-safe.",
      evidence_refs: [
        { type: "canonical_project", ref: "$COLLAB/harness-mc/milestones/self-learning/project.json" },
        { type: "canonical_task", ref: `$COLLAB/harness-mc/milestones/self-learning/tasks.json#${task.id}` },
      ],
      limitations: [
        "Missing canonical anchor or fresh contribution evidence; this proposal cannot choose a mutating operation.",
        "Proposal only; Vincent approval plus JV-32/JV-40 is required before any canonical write.",
      ],
      requires_approval: true,
    })),
    canonical_mutations: 0,
    canonical_deletions: 0,
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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
