import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateCommitAttention } from "./generate-commit-attention.mjs";

// Hermetic fixture root: task anchors come from scripts/fixtures, not live milestones,
// so this verifier stays green regardless of real task lifecycle.
const fixtureRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "commit-attention");

const fixtureWorktrees = {
  repositories: [
    {
      repo: "harness-mc",
      path_label: "$COLLAB/harness-mc",
      branch: "main",
      upstream: "origin/main",
      head: "abc1234",
      is_detached: false,
      staged_count: 0,
      unstaged_count: 1,
      untracked_count: 0,
      local_commits_count: 0,
      remote_commits_count: 0,
      status: "uncommitted",
      risk: "medium",
      suggested_action: "fixture",
      files: [{ indexStatus: " ", worktreeStatus: "M", path: "milestones/morrowise/tasks.json" }],
    },
    {
      repo: "unknown-repo",
      path_label: "$COLLAB/unknown-repo",
      branch: "main",
      upstream: null,
      head: "def5678",
      is_detached: false,
      staged_count: 0,
      unstaged_count: 0,
      untracked_count: 1,
      local_commits_count: 0,
      remote_commits_count: 0,
      status: "uncommitted",
      risk: "medium",
      suggested_action: "fixture",
      files: [{ indexStatus: "?", worktreeStatus: "?", path: "README.md" }],
    },
    {
      repo: "clean-repo",
      status: "clean",
      files: [],
    },
  ],
};

const data = generateCommitAttention({ worktrees: fixtureWorktrees, root: fixtureRoot, write: false });

assert.equal(data.read_only, true);
assert.equal(data.summary.repositories_need_attention, 2);
assert.equal(data.summary.repositories_uncommitted, 2);
assert.equal(data.summary.repositories_missing_task_anchor, 1);
assert.match(data.write_boundary.commit_gate, /worktree-commit/);
assert.ok(data.write_boundary.forbidden.includes("commit"));
assert.ok(data.write_boundary.forbidden.includes("push"));
assert.ok(data.notification.message.includes("missing/unclear task anchors"));

const harness = data.repositories.find((repo) => repo.repo === "harness-mc");
assert.ok(harness, "harness-mc fixture should be included");
assert.ok(harness.candidate_projects.includes("morrowise"));
assert.equal(harness.commit_attention.state, "task_anchor_available");
assert.ok(
  harness.task_links.some((link) => link.project === "morrowise" && link.active_tasks.some((task) => task.id === "fixture-anchor-task")),
  "fixture anchor task must appear as active task link",
);
assert.ok(
  !harness.task_links.some((link) => link.active_tasks.some((task) => task.id === "fixture-completed-task")),
  "completed fixture task must be filtered out of active tasks",
);

const unknown = data.repositories.find((repo) => repo.repo === "unknown-repo");
assert.ok(unknown, "unknown fixture should be included");
assert.equal(unknown.commit_attention.state, "missing_or_unclear_task_anchor");
assert.match(unknown.commit_attention.next_action, /建立或指定 MC task anchor/);

console.log("Commit attention verification OK");
