import assert from "node:assert/strict";
import { generateCommitCleanupPlan } from "./generate-commit-cleanup-plan.mjs";

const commitAttention = {
  version: 1,
  read_only: true,
  repositories: [
    {
      repo: "harness-mc",
      path_label: "$COLLAB/harness-mc",
      status: "uncommitted",
      local_commits_count: 0,
      remote_commits_count: 0,
      files: [{ path: "milestones/morrowise/tasks.json" }],
      task_links: [
        {
          project: "morrowise",
          state: "active_task_available",
          task_source: "$COLLAB/harness-mc/milestones/morrowise/tasks.json",
          active_tasks: [{ id: "runtime-scheduler-v0", title: "MorroWise agent-agnostic scheduler runtime v0" }],
        },
      ],
      commit_attention: {
        state: "task_anchor_available",
        needs_commit_gate: true,
      },
    },
    {
      repo: "notyet-harness",
      path_label: "$COLLAB/notyet-harness",
      status: "needs_reconcile",
      local_commits_count: 31,
      remote_commits_count: 13,
      files: [{ path: "000_Agent/memory/daily/2026-06-26.md" }],
      task_links: [
        {
          project: "morrowise",
          state: "active_task_available",
          task_source: "$COLLAB/harness-mc/milestones/morrowise/tasks.json",
          active_tasks: [{ id: "runtime-scheduler-v0", title: "MorroWise agent-agnostic scheduler runtime v0" }],
        },
      ],
      commit_attention: {
        state: "task_anchor_available",
        needs_commit_gate: true,
      },
    },
    {
      repo: "unknown-repo",
      path_label: "$COLLAB/unknown-repo",
      status: "uncommitted",
      local_commits_count: 0,
      remote_commits_count: 0,
      files: [{ path: "README.md" }],
      task_links: [],
      commit_attention: {
        state: "missing_or_unclear_task_anchor",
        needs_commit_gate: true,
      },
    },
    {
      repo: "docs-only",
      path_label: "$COLLAB/docs-only",
      status: "local_commits",
      local_commits_count: 2,
      remote_commits_count: 0,
      files: [],
      task_links: [],
      commit_attention: {
        state: "missing_or_unclear_task_anchor",
        needs_commit_gate: true,
      },
    },
    {
      repo: "mixed-repo",
      path_label: "$COLLAB/mixed-repo",
      status: "uncommitted",
      local_commits_count: 0,
      remote_commits_count: 0,
      files: [{ path: "milestones/morrowise/tasks.json" }, { path: "milestones/hiblocks/tasks.json" }],
      task_links: [
        {
          project: "morrowise",
          state: "active_task_available",
          task_source: "$COLLAB/harness-mc/milestones/morrowise/tasks.json",
          active_tasks: [{ id: "runtime-scheduler-v0", title: "MorroWise agent-agnostic scheduler runtime v0" }],
        },
        {
          project: "hiblocks",
          state: "active_task_available",
          task_source: "$COLLAB/harness-mc/milestones/hiblocks/tasks.json",
          active_tasks: [{ id: "hiblocks-site-prefill-contract", title: "HiBlocks site prefill contract" }],
        },
      ],
      commit_attention: {
        state: "task_anchor_available",
        needs_commit_gate: true,
      },
    },
  ],
};

const plan = generateCommitCleanupPlan({ commitAttention, write: false });

assert.equal(plan.read_only, true);
assert.equal(plan.summary.total_repositories, 5);
assert.equal(plan.summary.plan_allowed, 1);
assert.equal(plan.summary.blocked, 3);
assert.equal(plan.summary.push_decision_required, 1);
assert.ok(plan.write_boundary.forbidden.includes("git add"));
assert.ok(plan.write_boundary.forbidden.includes("git commit"));
assert.ok(plan.write_boundary.forbidden.includes("git push"));

const harness = plan.plans.find((item) => item.repo === "harness-mc");
assert.ok(harness, "harness-mc plan should exist");
assert.equal(harness.preflight_result.state, "required_before_diff_review");
assert.match(harness.preflight_result.command, /work-anchor-preflight\.mjs --project morrowise --task-id runtime-scheduler-v0 --json/);
assert.equal(harness.planning_state, "plan_allowed");
assert.equal(harness.candidate_task_anchor.project, "morrowise");
assert.equal(harness.candidate_task_anchor.task_id, "runtime-scheduler-v0");
assert.equal(harness.commit_groups[0].state, "pending_scoped_diff_review");
assert.deepEqual(harness.excluded_files, ["milestones/morrowise/tasks.json"]);
assert.ok(harness.verification_commands.includes("npm run test:commit-attention"));
assert.ok(harness.verification_commands.includes("npm run test:commit-planning-gate"));
assert.equal(harness.approval_required, true);

const notyet = plan.plans.find((item) => item.repo === "notyet-harness");
assert.ok(notyet, "notyet-harness plan should exist");
assert.equal(notyet.planning_state, "blocked");
assert.equal(notyet.preflight_result.state, "blocked");
assert.match(notyet.risks.join("\n"), /reconcile/);
assert.deepEqual(notyet.commit_groups, []);

const unknown = plan.plans.find((item) => item.repo === "unknown-repo");
assert.ok(unknown, "unknown-repo plan should exist");
assert.equal(unknown.planning_state, "blocked");
assert.match(unknown.preflight_result.reason, /task anchor/);

const docsOnly = plan.plans.find((item) => item.repo === "docs-only");
assert.ok(docsOnly, "docs-only plan should exist");
assert.equal(docsOnly.planning_state, "push_decision_required");
assert.match(docsOnly.preflight_result.reason, /Vincent/);

const mixed = plan.plans.find((item) => item.repo === "mixed-repo");
assert.ok(mixed, "mixed-repo plan should exist");
assert.equal(mixed.planning_state, "blocked");
assert.equal(mixed.preflight_result.state, "blocked");
assert.match(mixed.preflight_result.reason, /Multiple candidate task anchors/);
assert.match(mixed.risks.join("\n"), /diff_scope_too_mixed/);
assert.equal(mixed.candidate_task_anchor, null);

for (const item of plan.plans) {
  for (const field of [
    "repo",
    "repo_status",
    "candidate_task_anchor",
    "preflight_result",
    "commit_groups",
    "excluded_files",
    "verification_commands",
    "risks",
    "approval_required",
  ]) {
    assert.ok(Object.hasOwn(item, field), `${item.repo} missing required field ${field}`);
  }
}

console.log("MorroWise commit cleanup plan verification OK");
