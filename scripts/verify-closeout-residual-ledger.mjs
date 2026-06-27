import assert from "node:assert/strict";
import { generateCloseoutResidualLedger } from "./generate-closeout-residual-ledger.mjs";

const fixture = {
  commitAttention: {
    generated_at: "2026-06-27T01:00:00.000Z",
    repositories: [
      {
        repo: "harness-mc",
        files: [{ path: "milestones/morrowise/tasks.json" }],
        task_links: [
          {
            project: "morrowise",
            state: "active_task_available",
            task_source: "$COLLAB/harness-mc/milestones/morrowise/tasks.json",
            active_tasks: [{ id: "runtime-closeout-residual-ledger", title: "Runtime Closeout Residual Ledger read model" }],
          },
        ],
      },
    ],
  },
  worktrees: {
    generated_at: "2026-06-27T01:01:00.000Z",
    repositories: [
      {
        repo: "harness-mc",
        path_label: "$COLLAB/harness-mc",
        branch: "main",
        head: "abc1234",
        status: "uncommitted",
        staged_count: 0,
        unstaged_count: 2,
        untracked_count: 1,
        local_commits_count: 0,
        remote_commits_count: 0,
        files: [{ path: "milestones/morrowise/tasks.json" }, { path: "scripts/generate-closeout-residual-ledger.mjs" }],
      },
      {
        repo: "notyet-harness",
        path_label: "$COLLAB/notyet-harness",
        branch: "main",
        head: "def5678",
        status: "needs_reconcile",
        staged_count: 0,
        unstaged_count: 0,
        untracked_count: 0,
        local_commits_count: 2,
        remote_commits_count: 1,
        files: [],
      },
      {
        repo: "rrrealll",
        path_label: "$COLLAB/RRREALLL_V2.0",
        branch: "main",
        head: "fed4321",
        status: "local_commits",
        staged_count: 0,
        unstaged_count: 0,
        untracked_count: 0,
        local_commits_count: 1,
        remote_commits_count: 0,
        files: [],
      },
    ],
  },
  cleanupPlan: {
    generated_at: "2026-06-27T01:02:00.000Z",
    plans: [
      {
        repo: "harness-mc",
        repo_status: "uncommitted",
        planning_state: "plan_allowed",
        candidate_task_anchor: { project: "morrowise", task_id: "runtime-closeout-residual-ledger" },
        excluded_files: ["milestones/morrowise/tasks.json", "scripts/generate-closeout-residual-ledger.mjs"],
        risks: ["Dirty scope is not reviewed yet."],
        next_action: "Run work-anchor preflight.",
      },
      {
        repo: "notyet-harness",
        repo_status: "needs_reconcile",
        planning_state: "blocked",
        candidate_task_anchor: null,
        excluded_files: [],
        risks: ["Repo has branch divergence."],
        next_action: "Resolve branch divergence.",
      },
    ],
  },
  taskEvents: {
    generated_at: "2026-06-27T01:03:00.000Z",
    task_events: { pending: 1, applied: 0, rejected: 0 },
    sync_events: { pending: 0, synced: 0, failed: 0 },
  },
  pendingTaskEvents: [
    {
      id: "event-1",
      file: "event-1.json",
      type: "task.commit_attached",
      project: "morrowise",
      task_id: "runtime-scheduler-v0",
      repo: "notyet-harness",
      commit: "abc1234",
      created_at: "2026-06-27T01:04:00.000Z",
    },
  ],
  completedWithoutCommitEvidence: [
    {
      project: "legacy",
      task_id: "done-without-commit",
      status: "completed",
      title: "Done without commit",
      task_source: "$COLLAB/harness-mc/milestones/legacy/tasks.json",
    },
  ],
};

const data = generateCloseoutResidualLedger({ ...fixture, write: false });

assert.equal(data.schema_version, "closeout-residual-ledger.v0");
assert.equal(data.read_only, true);
assert.equal(data.summary.repositories_dirty, 1);
assert.equal(data.summary.repositories_ahead, 2);
assert.equal(data.summary.repositories_behind, 1);
assert.equal(data.summary.repositories_diverged, 1);
assert.equal(data.summary.excluded_changes, 2);
assert.equal(data.summary.pending_task_events, 1);
assert.equal(data.summary.completed_without_commit_evidence, 1);
assert.equal(data.summary.cleanup_plan_leftovers, 2);
assert.equal(data.next_closeout_anchor.type, "apply_task_events");
assert.equal(data.next_action.type, "command");
assert.match(data.next_action.target, /apply-task-events\.mjs/);

for (const field of [
  "generated_at",
  "source_files",
  "summary",
  "repositories",
  "excluded_changes",
  "pending_task_events",
  "completed_without_commit_evidence",
  "cleanup_plan_leftovers",
  "next_closeout_anchor",
  "write_boundary",
  "verifier_ref",
]) {
  assert.ok(Object.hasOwn(data, field), `missing ${field}`);
}

for (const forbidden of ["git add", "git commit", "git push", "apply task events", "mutate tasks.json"]) {
  assert.ok(data.write_boundary.forbidden.includes(forbidden), `write boundary should forbid ${forbidden}`);
}

const harness = data.repositories.find((repo) => repo.repo === "harness-mc");
assert.ok(harness, "harness-mc residual should exist");
assert.equal(harness.residual_state, "dirty_needs_commit_gate");
assert.equal(harness.next_action.type, "work_anchor_preflight");
assert.equal(harness.candidate_task_anchor.task_id, "runtime-closeout-residual-ledger");

const notyet = data.repositories.find((repo) => repo.repo === "notyet-harness");
assert.ok(notyet, "notyet-harness residual should exist");
assert.equal(notyet.residual_state, "diverged");
assert.equal(notyet.next_action.type, "manual_reconcile");

const cleanData = generateCloseoutResidualLedger({
  commitAttention: { generated_at: "2026-06-27T02:00:00.000Z", repositories: [] },
  worktrees: { generated_at: "2026-06-27T02:00:00.000Z", repositories: [] },
  cleanupPlan: { generated_at: "2026-06-27T02:00:00.000Z", plans: [] },
  taskEvents: { generated_at: "2026-06-27T02:00:00.000Z", task_events: { pending: 0 }, sync_events: { pending: 0 } },
  pendingTaskEvents: [],
  completedWithoutCommitEvidence: [],
  write: false,
});

assert.equal(cleanData.summary.residual_count, 0);
assert.equal(cleanData.next_closeout_anchor.type, "none");
assert.equal(cleanData.next_action.type, "none");

console.log("Closeout residual ledger verification OK");
