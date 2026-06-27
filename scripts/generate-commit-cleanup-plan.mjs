import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outPath = path.join(root, "public", "data", "commit-cleanup-plan.json");
const attentionPath = path.join(root, "public", "data", "commit-attention.json");
const registryPath = path.join(root, "system-workflow", "registries", "morrowise-commit-planning-gate.json");

const DEFAULT_VERIFICATION_COMMANDS = [
  "npm run test:commit-attention",
  "npm run test:commit-planning-gate",
  "npm run test:commit-cleanup-plan",
];

export function generateCommitCleanupPlan(options = {}) {
  const commitAttention = options.commitAttention || readJson(attentionPath);
  const registry = options.registry || readJson(registryPath);
  const plans = (commitAttention.repositories || []).map((repo) => buildPlan(repo, registry));
  const summary = summarize(plans);
  const data = {
    version: 1,
    generated_at: new Date().toISOString(),
    read_only: true,
    source: {
      commit_attention: "$COLLAB/harness-mc/public/data/commit-attention.json",
      planning_gate: "$COLLAB/harness-mc/system-workflow/registries/morrowise-commit-planning-gate.json",
      generator: "$COLLAB/harness-mc/scripts/generate-commit-cleanup-plan.mjs",
    },
    write_boundary: registry.write_boundary,
    summary,
    plans,
  };

  if (options.write !== false) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(data, null, 2)}\n`);
    console.log(
      `Generated ${outPath} — ${summary.plan_allowed} allowed, ${summary.blocked} blocked, ${summary.push_decision_required} push decisions`,
    );
  }

  return data;
}

function buildPlan(repo, registry) {
  const candidateTaskAnchor = selectTaskAnchor(repo);
  const activeAnchors = activeTaskAnchors(repo);
  const planningState = classifyPlanningState(repo, activeAnchors);
  const preflightResult = buildPreflightResult(repo, planningState, candidateTaskAnchor, activeAnchors);

  return {
    repo: repo.repo,
    repo_status: repo.status,
    path_label: repo.path_label || null,
    planning_state: planningState,
    candidate_task_anchor: candidateTaskAnchor,
    preflight_result: preflightResult,
    commit_groups: buildCommitGroups(repo, planningState),
    excluded_files: (repo.files || []).map((file) => file.path),
    verification_commands: DEFAULT_VERIFICATION_COMMANDS,
    risks: buildRisks(repo, planningState),
    approval_required: true,
    handoff_gate: registry.write_boundary?.handoff_gate || registry.write_boundary?.commit_gate || null,
    next_action: nextAction(repo, planningState, candidateTaskAnchor, activeAnchors),
  };
}

function classifyPlanningState(repo, activeAnchors) {
  if (repo.status === "needs_reconcile") return "blocked";
  if (repo.status === "local_commits") return "push_decision_required";
  if (activeAnchors.length > 1) return "blocked";
  if (repo.commit_attention?.state === "missing_or_unclear_task_anchor") return "blocked";
  if (repo.commit_attention?.state === "task_anchor_available") return "plan_allowed";
  return "blocked";
}

function selectTaskAnchor(repo) {
  const anchors = activeTaskAnchors(repo);
  return anchors.length === 1 ? anchors[0] : null;
}

function activeTaskAnchors(repo) {
  const anchors = [];
  for (const link of repo.task_links || []) {
    if (link.state !== "active_task_available") continue;
    for (const task of link.active_tasks || []) {
      anchors.push({
        project: link.project,
        task_id: task.id,
        task_title: task.title || null,
        task_source: link.task_source,
      });
    }
  }
  return anchors;
}

function buildPreflightResult(repo, planningState, candidateTaskAnchor, activeAnchors) {
  if (planningState === "blocked") {
    if (repo.status === "needs_reconcile") {
      return {
        state: "blocked",
        reason: "Repo needs reconcile before commit planning.",
      };
    }
    if (activeAnchors.length > 1) {
      return {
        state: "blocked",
        reason: "Multiple candidate task anchors detected; split or narrow the dirty scope before diff review.",
        candidate_task_anchor_count: activeAnchors.length,
        candidate_task_anchors_sample: activeAnchors.slice(0, 20),
      };
    }
    return {
      state: "blocked",
      reason: "Missing or unclear MC task anchor; create or select a task anchor before diff review.",
    };
  }

  if (planningState === "push_decision_required") {
    return {
      state: "push_decision_required",
      reason: "Local commits already exist; verify task/event linkage and ask Vincent before push.",
    };
  }

  return {
    state: "required_before_diff_review",
    command: [
      "node scripts/work-anchor-preflight.mjs",
      `--project ${candidateTaskAnchor.project}`,
      `--task-id ${candidateTaskAnchor.task_id}`,
      "--json",
    ].join(" "),
  };
}

function buildCommitGroups(repo, planningState) {
  if (planningState !== "plan_allowed") return [];
  return [
    {
      group_id: `${repo.repo}-pending-scope-review`,
      state: "pending_scoped_diff_review",
      reason: "This gate does not read diffs. Run work-anchor preflight, inspect scoped diffs, then group files in worktree-commit.",
      candidate_files_sample: (repo.files || []).map((file) => file.path),
    },
  ];
}

function buildRisks(repo, planningState) {
  const risks = [];
  if (repo.status === "needs_reconcile") risks.push("Repo has branch divergence or detached HEAD; reconcile before planning commit scope.");
  if (repo.status === "local_commits") risks.push("Repo has local commits; push is an explicit Vincent decision.");
  if (activeTaskAnchors(repo).length > 1) risks.push("diff_scope_too_mixed: multiple candidate task anchors were detected.");
  if (repo.commit_attention?.state === "missing_or_unclear_task_anchor") {
    risks.push("Dirty or local work has no clear MC task anchor.");
  }
  if (planningState === "plan_allowed") {
    risks.push("Dirty scope is not reviewed yet; detailed diff reading belongs to worktree-commit after preflight.");
  }
  return risks;
}

function nextAction(repo, planningState, candidateTaskAnchor, activeAnchors) {
  if (planningState === "blocked" && repo.status === "needs_reconcile") {
    return "Stop here; resolve branch divergence or detached HEAD before commit planning.";
  }
  if (planningState === "blocked" && activeAnchors.length > 1) {
    return "Stop here; split or narrow the dirty scope to one MC task anchor before diff review.";
  }
  if (planningState === "blocked") return "Stop here; establish one MC task anchor before diff review.";
  if (planningState === "push_decision_required") return "Verify task/event linkage, then ask Vincent whether to push.";
  return `Run work-anchor preflight for ${candidateTaskAnchor.project}/${candidateTaskAnchor.task_id}, then prepare worktree-commit plan.`;
}

function summarize(plans) {
  return {
    total_repositories: plans.length,
    plan_allowed: plans.filter((plan) => plan.planning_state === "plan_allowed").length,
    blocked: plans.filter((plan) => plan.planning_state === "blocked").length,
    push_decision_required: plans.filter((plan) => plan.planning_state === "push_decision_required").length,
  };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isCli) generateCommitCleanupPlan();
