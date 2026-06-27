import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outPath = path.join(root, "public", "data", "closeout-residual-ledger.json");

const SOURCE_FILES = {
  commit_attention: "$COLLAB/harness-mc/public/data/commit-attention.json",
  worktrees: "$COLLAB/harness-mc/public/data/worktrees.json",
  commit_cleanup_plan: "$COLLAB/harness-mc/public/data/commit-cleanup-plan.json",
  task_events: "$COLLAB/harness-mc/public/data/task-events.json",
  task_event_queue: "$COLLAB/harness-mc/task-events/pending/*.json",
  task_state: "$COLLAB/harness-mc/milestones/*/tasks.json",
  generator: "$COLLAB/harness-mc/scripts/generate-closeout-residual-ledger.mjs",
};

const WRITE_BOUNDARY = {
  mode: "read_only_residual_audit",
  allowed: [
    "read generated commit-attention/worktree/cleanup-plan/task-event data",
    "read MC task metadata",
    "classify residual closeout work",
    "write generated residual ledger read model",
    "route next_action to an existing gate or task proposal",
  ],
  forbidden: [
    "git add",
    "git commit",
    "git push",
    "apply task events",
    "mutate tasks.json",
    "close task",
    "send external notification",
    "read secrets",
  ],
  downstream_gates: {
    work_anchor_preflight: "$COLLAB/harness-mc/scripts/work-anchor-preflight.mjs",
    apply_task_events: "$COLLAB/harness-mc/scripts/apply-task-events.mjs",
    worktree_commit: "$COLLAB/notyet-harness/000_Agent/skills/worktree-commit/SKILL.md",
    task_proposal: "$COLLAB/harness-mc/milestones/morrowise/tasks.json",
  },
};

export function generateCloseoutResidualLedger(options = {}) {
  const repoRoot = options.root || root;
  const commitAttention = options.commitAttention ?? readJsonOrNull(path.join(repoRoot, "public", "data", "commit-attention.json"));
  const worktrees = options.worktrees ?? readJsonOrNull(path.join(repoRoot, "public", "data", "worktrees.json"));
  const cleanupPlan = options.cleanupPlan ?? readJsonOrNull(path.join(repoRoot, "public", "data", "commit-cleanup-plan.json"));
  const taskEvents = options.taskEvents ?? readJsonOrNull(path.join(repoRoot, "public", "data", "task-events.json"));
  const pendingTaskEvents = options.pendingTaskEvents ?? readPendingTaskEvents(repoRoot);
  const completedWithoutCommitEvidence = options.completedWithoutCommitEvidence ?? findCompletedWithoutCommitEvidence(repoRoot);

  const repositories = buildRepositoryResiduals({ commitAttention, worktrees, cleanupPlan });
  const excludedChanges = buildExcludedChanges(cleanupPlan);
  const cleanupPlanLeftovers = buildCleanupPlanLeftovers(cleanupPlan);
  const nextCloseoutAnchor = selectNextCloseoutAnchor({
    repositories,
    pendingTaskEvents,
    completedWithoutCommitEvidence,
    cleanupPlanLeftovers,
  });

  const summary = {
    residual_count:
      repositories.filter((repo) => repo.residual_state !== "clean").length
      + excludedChanges.length
      + pendingTaskEvents.length
      + completedWithoutCommitEvidence.length
      + cleanupPlanLeftovers.length,
    repositories_dirty: repositories.filter((repo) => repo.dirty).length,
    repositories_ahead: repositories.filter((repo) => repo.ahead > 0).length,
    repositories_behind: repositories.filter((repo) => repo.behind > 0).length,
    repositories_diverged: repositories.filter((repo) => repo.ahead > 0 && repo.behind > 0).length,
    excluded_changes: excludedChanges.length,
    pending_task_events: pendingTaskEvents.length,
    completed_without_commit_evidence: completedWithoutCommitEvidence.length,
    cleanup_plan_leftovers: cleanupPlanLeftovers.length,
    missing_next_anchor: nextCloseoutAnchor.type === "task_proposal_required" ? 1 : 0,
  };

  const data = {
    schema_version: "closeout-residual-ledger.v0",
    generated_at: new Date().toISOString(),
    read_only: true,
    source_files: Object.values(SOURCE_FILES),
    upstream: {
      commit_attention_generated_at: commitAttention?.generated_at || null,
      worktrees_generated_at: worktrees?.generated_at || null,
      commit_cleanup_plan_generated_at: cleanupPlan?.generated_at || null,
      task_events_generated_at: taskEvents?.generated_at || null,
    },
    write_boundary: WRITE_BOUNDARY,
    stale_rule: "Regenerate after cc-log, worktree-commit, task-event reducer runs, file edits, commits, checkouts, pushes, or handoff.",
    summary,
    repositories,
    excluded_changes: excludedChanges,
    pending_task_events: pendingTaskEvents,
    completed_without_commit_evidence: completedWithoutCommitEvidence,
    cleanup_plan_leftovers: cleanupPlanLeftovers,
    next_closeout_anchor: nextCloseoutAnchor,
    next_action: nextCloseoutAnchor.action,
    verifier_ref: "npm run test:closeout-residual-ledger",
  };

  if (options.write !== false) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(data, null, 2)}\n`);
    console.log(
      `Generated ${outPath} — ${summary.residual_count} residuals, next: ${data.next_action.type}:${data.next_action.target || "none"}`,
    );
  }

  return data;
}

function buildRepositoryResiduals({ commitAttention, worktrees, cleanupPlan }) {
  const cleanupByRepo = new Map((cleanupPlan?.plans || []).map((plan) => [plan.repo, plan]));
  const attentionByRepo = new Map((commitAttention?.repositories || []).map((repo) => [repo.repo, repo]));
  const repos = worktrees?.repositories || commitAttention?.repositories || [];

  return repos
    .filter((repo) => repo.status !== "clean")
    .map((repo) => {
      const attention = attentionByRepo.get(repo.repo) || {};
      const cleanup = cleanupByRepo.get(repo.repo) || {};
      const dirtyCount = (repo.staged_count || 0) + (repo.unstaged_count || 0) + (repo.untracked_count || 0);
      const ahead = repo.local_commits_count || 0;
      const behind = repo.remote_commits_count || 0;
      const residualState = classifyRepoResidual({ repo, dirtyCount, ahead, behind, cleanup });
      const candidateTaskAnchor = cleanup.candidate_task_anchor || firstCandidateAnchor(attention) || null;

      return {
        repo: repo.repo,
        path_label: repo.path_label || null,
        branch: repo.branch || null,
        head: repo.head || null,
        status: repo.status,
        residual_state: residualState,
        dirty: dirtyCount > 0,
        ahead,
        behind,
        diverged: ahead > 0 && behind > 0,
        staged_count: repo.staged_count || 0,
        unstaged_count: repo.unstaged_count || 0,
        untracked_count: repo.untracked_count || 0,
        candidate_task_anchor: candidateTaskAnchor,
        cleanup_planning_state: cleanup.planning_state || null,
        files_sample: (repo.files || attention.files || []).slice(0, 20).map((file) => file.path || file),
        next_action: repoNextAction({ repo, residualState, candidateTaskAnchor, cleanup }),
      };
    });
}

function classifyRepoResidual({ repo, dirtyCount, ahead, behind, cleanup }) {
  if (behind > 0 && ahead > 0) return "diverged";
  if (behind > 0 || repo.status === "needs_reconcile") return "needs_reconcile";
  if (dirtyCount > 0 && cleanup.planning_state === "blocked") return "dirty_blocked";
  if (dirtyCount > 0) return "dirty_needs_commit_gate";
  if (ahead > 0) return "ahead_needs_push_decision";
  return "needs_review";
}

function repoNextAction({ repo, residualState, candidateTaskAnchor, cleanup }) {
  if (residualState === "needs_reconcile" || residualState === "diverged") {
    return action("manual_reconcile", repo.repo, "Resolve branch divergence or behind state before closeout planning.");
  }
  if (cleanup.planning_state === "blocked" && !candidateTaskAnchor) {
    return action("task_proposal", repo.repo, "Create or select one MC task anchor before scoped diff review.");
  }
  if (residualState === "ahead_needs_push_decision") {
    return action("approval", "push_decision_required", "Verify task/event linkage, then ask Vincent whether to push.");
  }
  if (candidateTaskAnchor) {
    return action(
      "work_anchor_preflight",
      `${candidateTaskAnchor.project}/${candidateTaskAnchor.task_id}`,
      "Run work-anchor preflight, then enter worktree-commit gate.",
    );
  }
  return action("worktree_commit", repo.repo, "Use worktree-commit gate after selecting the correct task anchor.");
}

function buildExcludedChanges(cleanupPlan) {
  const items = [];
  for (const plan of cleanupPlan?.plans || []) {
    for (const file of plan.excluded_files || []) {
      items.push({
        repo: plan.repo,
        path: file,
        reason: plan.planning_state === "plan_allowed"
          ? "Excluded from pre-diff cleanup plan until worktree-commit scoped review."
          : "Repo is blocked or waiting for a decision; file remains residual.",
        candidate_task_anchor: plan.candidate_task_anchor || null,
      });
    }
  }
  return items;
}

function buildCleanupPlanLeftovers(cleanupPlan) {
  return (cleanupPlan?.plans || [])
    .filter((plan) => plan.planning_state !== "plan_allowed" || (plan.excluded_files || []).length > 0)
    .map((plan) => ({
      repo: plan.repo,
      planning_state: plan.planning_state,
      repo_status: plan.repo_status,
      candidate_task_anchor: plan.candidate_task_anchor || null,
      excluded_files_count: (plan.excluded_files || []).length,
      risks: plan.risks || [],
      next_action: plan.next_action || null,
    }));
}

function selectNextCloseoutAnchor({ repositories, pendingTaskEvents, completedWithoutCommitEvidence, cleanupPlanLeftovers }) {
  if (pendingTaskEvents.length > 0) {
    return {
      type: "apply_task_events",
      project: "harness-mc",
      task_id: "acp-apply-task-events",
      reason: "Pending task events should be reduced before claiming closeout is clean.",
      action: action("command", "node scripts/apply-task-events.mjs", "Run or review the task-event reducer before next closeout."),
    };
  }

  const repoWithAnchor = repositories.find((repo) => repo.candidate_task_anchor);
  if (repoWithAnchor) {
    const anchor = repoWithAnchor.candidate_task_anchor;
    return {
      type: "work_anchor_preflight",
      project: anchor.project,
      task_id: anchor.task_id,
      reason: `${repoWithAnchor.repo} still has residual work tied to an MC task anchor.`,
      action: action("work_anchor_preflight", `${anchor.project}/${anchor.task_id}`, "Run work-anchor preflight, then worktree-commit gate."),
    };
  }

  if (completedWithoutCommitEvidence.length > 0) {
    return {
      type: "task_proposal_required",
      project: "morrowise",
      task_id: "runtime-closeout-residual-ledger",
      reason: "Completed tasks without commit evidence need audit or task-state repair.",
      action: action("task_proposal", "completed-work-commit-evidence-audit", "Create a scoped task-state evidence audit before closing residuals."),
    };
  }

  if (cleanupPlanLeftovers.length > 0) {
    return {
      type: "worktree_commit_gate",
      project: "morrowise",
      task_id: "runtime-closeout-residual-ledger",
      reason: "Cleanup plan leftovers remain after the latest closeout pass.",
      action: action("worktree_commit", "cleanup-plan-leftovers", "Resolve cleanup-plan leftovers through the commit gate."),
    };
  }

  return {
    type: "none",
    project: null,
    task_id: null,
    reason: "No closeout residuals detected in generated sources.",
    action: action("none", null, "No residual closeout action required."),
  };
}

function firstCandidateAnchor(repo) {
  for (const link of repo.task_links || []) {
    if (link.state !== "active_task_available") continue;
    const task = (link.active_tasks || [])[0];
    if (!task) continue;
    return {
      project: link.project,
      task_id: task.id,
      task_title: task.title || null,
      task_source: link.task_source || null,
    };
  }
  return null;
}

function readPendingTaskEvents(repoRoot) {
  const pendingDir = path.join(repoRoot, "task-events", "pending");
  if (!fs.existsSync(pendingDir)) return [];
  return fs
    .readdirSync(pendingDir)
    .filter((fileName) => fileName.endsWith(".json"))
    .sort()
    .map((fileName) => {
      const event = readJsonOrNull(path.join(pendingDir, fileName)) || {};
      return {
        id: event.event_id || fileName,
        file: fileName,
        type: event.type || "unknown",
        project: event.project || "",
        task_id: event.task_id || "",
        repo: event.repo || "",
        commit: event.commit || "",
        created_at: event.created_at || "",
      };
    });
}

function findCompletedWithoutCommitEvidence(repoRoot) {
  const milestonesDir = path.join(repoRoot, "milestones");
  if (!fs.existsSync(milestonesDir)) return [];
  const items = [];
  for (const entry of fs.readdirSync(milestonesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const tasksPath = path.join(milestonesDir, entry.name, "tasks.json");
    if (!fs.existsSync(tasksPath)) continue;
    const data = readJsonOrNull(tasksPath);
    for (const task of data?.tasks || []) {
      if (!["completed", "done", "fixed"].includes(task.status)) continue;
      if (Array.isArray(task.commits) && task.commits.length > 0) continue;
      items.push({
        project: entry.name,
        task_id: task.id,
        status: task.status,
        title: task.title || "",
        task_source: `$COLLAB/harness-mc/milestones/${entry.name}/tasks.json`,
      });
    }
  }
  return items;
}

function action(type, target, label) {
  return { type, target, label };
}

function readJsonOrNull(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isCli) generateCloseoutResidualLedger();
