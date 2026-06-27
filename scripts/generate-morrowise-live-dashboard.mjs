import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(__dirname, "..");

const DATA_DIR = path.join("public", "data");
const CONTRACT_REF = "$COLLAB/harness-mc/system-workflow/docs/specs/morrowise-live-dashboard-read-model-contract.md";
const STANDARD_REF = "$COLLAB/harness-mc/system-workflow/docs/specs/morrowise-live-system-verification-standard.md";
const AUDIT_REF = "$COLLAB/harness-mc/system-workflow/docs/specs/morrowise-live-surface-audit.md";
const ONE_MINUTE = 60 * 1000;

export function generateMorrowiseLiveDashboard(options = {}) {
  const root = options.root || defaultRoot;
  const generatedAt = options.generatedAt || new Date().toISOString();

  const sources = readSources(root);
  const surfaces = [
    systemAttentionSurface(sources),
    morrowiseLivingSystemSurface(sources),
    morrowiseProactiveLoopSurface(sources),
    taskEventPipelineSurface(sources),
    visualSyncCoverageSurface(sources),
    worktreeStatusSurface(sources),
    closeoutResidualLedgerSurface(sources),
    capabilityRegistrySurface(sources),
    approvalQueueSurface(sources),
  ];

  const data = {
    schema_version: "morrowise-live-dashboard.v0",
    generated_at: generatedAt,
    read_only: true,
    source_of_truth: {
      collab_root: "$COLLAB",
      canonical_task_state: ["$COLLAB/harness-mc/milestones/*/tasks.json"],
      generated_data: [
        "$COLLAB/harness-mc/public/data/projects.json",
        "$COLLAB/harness-mc/public/data/task-events.json",
        "$COLLAB/harness-mc/public/data/visual-sync-coverage.json",
        "$COLLAB/harness-mc/public/data/worktrees.json",
        "$COLLAB/harness-mc/public/data/closeout-residual-ledger.json",
        "$COLLAB/harness-mc/public/data/changes.json",
        "$COLLAB/harness-mc/public/data/morrowise-proactive-loop.json",
        "$COLLAB/harness-mc/public/data/morrowise-capabilities.json",
      ],
      policy_registry: "$COLLAB/harness-mc/system-workflow/registries/morrowise-approval-policy.json",
      visual_layers_are: "mirrors_only",
    },
    summary: buildSummary(surfaces, sources),
    surfaces,
    loop_chain: buildLoopChain(sources),
    routes: buildRoutes(),
    approval_queue: buildApprovalQueue(sources),
    completion_gate: buildCompletionGate(sources),
    verification: {
      contract_ref: CONTRACT_REF,
      standard_ref: STANDARD_REF,
      audit_ref: AUDIT_REF,
      verifier_ref: "npm run test:morrowise-live-dashboard",
      verifier_refs: ["npm run test:morrowise-live-dashboard", "npm run test:morrowise-live-loop"],
      last_verified_at: null,
    },
  };

  if (options.write !== false) {
    const outPath = path.join(root, DATA_DIR, "morrowise-live-dashboard.json");
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(data, null, 2)}\n`);
    console.log(`Generated ${outPath} — ${surfaces.length} surfaces, ${data.approval_queue.length} approval requests`);
  }

  return data;
}

function readSources(root) {
  return {
    root,
    projects: readJsonOrNull(path.join(root, DATA_DIR, "projects.json")),
    taskEvents: readJsonOrNull(path.join(root, DATA_DIR, "task-events.json")),
    visualSyncCoverage: readJsonOrNull(path.join(root, DATA_DIR, "visual-sync-coverage.json")),
    worktrees: readJsonOrNull(path.join(root, DATA_DIR, "worktrees.json")),
    closeoutResidualLedger: readJsonOrNull(path.join(root, DATA_DIR, "closeout-residual-ledger.json")),
    changes: readJsonOrNull(path.join(root, DATA_DIR, "changes.json")),
    proactiveLoop: readJsonOrNull(path.join(root, DATA_DIR, "morrowise-proactive-loop.json")),
    capabilities: readJsonOrNull(path.join(root, DATA_DIR, "morrowise-capabilities.json")),
    approvalPolicy: readJsonOrNull(path.join(root, "system-workflow", "registries", "morrowise-approval-policy.json")),
    fileTimes: {
      projects: fileGeneratedAt(root, path.join(DATA_DIR, "projects.json")),
      taskEvents: fileGeneratedAt(root, path.join(DATA_DIR, "task-events.json")),
      visualSyncCoverage: fileGeneratedAt(root, path.join(DATA_DIR, "visual-sync-coverage.json")),
      worktrees: fileGeneratedAt(root, path.join(DATA_DIR, "worktrees.json")),
      closeoutResidualLedger: fileGeneratedAt(root, path.join(DATA_DIR, "closeout-residual-ledger.json")),
      changes: fileGeneratedAt(root, path.join(DATA_DIR, "changes.json")),
      proactiveLoop: fileGeneratedAt(root, path.join(DATA_DIR, "morrowise-proactive-loop.json")),
      capabilities: fileGeneratedAt(root, path.join(DATA_DIR, "morrowise-capabilities.json")),
      approvalPolicy: fileGeneratedAt(root, path.join("system-workflow", "registries", "morrowise-approval-policy.json")),
    },
  };
}

function systemAttentionSurface(sources) {
  const changes = sources.changes || {};
  const taskEvents = sources.taskEvents || {};
  const staleCount = Array.isArray(changes.stale) ? changes.stale.length : 0;
  const eventCount = Array.isArray(changes.events) ? changes.events.length : 0;
  const pendingEvents = taskEvents.task_events?.pending || 0;

  return surface({
    id: "system_attention",
    label: "System Attention",
    source_of_truth: "generated_attention_state",
    source_files: ["$COLLAB/harness-mc/public/data/changes.json", "$COLLAB/harness-mc/public/data/task-events.json"],
    generator: ["scripts/sentinel-diff.mjs", "scripts/generate-task-event-data.mjs", "npm run prebuild"],
    generated_at: latest([changes.generated_at, taskEvents.generated_at, sources.fileTimes.changes, sources.fileTimes.taskEvents]),
    stale_after_minutes: 15,
    stale_rule: "stale when generated attention data is older than 15 minutes during an active session, or after task-event/worktree regeneration changes upstream state",
    missing_sources: missingSources(sources, ["changes", "taskEvents"]),
    freshness_action: action("generator", "npm run prebuild", "Regenerate changes.json and task-events.json before trusting System Attention."),
    next_action: pendingEvents > 0 || staleCount > 0
      ? action("route_or_task", "surface.system_attention.drilldown", "Review stale, blocked, or pending queue items.")
      : action("none", null, "No attention action required from the current generated data."),
    write_boundary: readOnlyBoundary(["display generated attention state", "link to evidence"], ["close tasks", "reduce event queues", "write mirrors"]),
    verifier_ref: "npm run test:morrowise-live-dashboard",
    classification: "semi_live",
    attention_level: staleCount > 0 || pendingEvents > 0 || eventCount > 0 ? "needs_review" : "normal",
    evidence_refs: ["$COLLAB/harness-mc/public/data/changes.json", "$COLLAB/harness-mc/public/data/task-events.json"],
    drilldown_route: "surface.system_attention.drilldown",
    metrics: { stale: staleCount, events: eventCount, pending_task_events: pendingEvents },
  });
}

function morrowiseLivingSystemSurface(sources) {
  const harnessProject = findProject(sources.projects, "harness-mc");
  const morrowiseTasks = (harnessProject?.tasks || []).filter((task) => task.track === "morrowise-system" || task.id.startsWith("morrowise-"));
  const nextTask = morrowiseTasks.find((task) => ["todo", "in_progress", "blocked"].includes(task.status)) || null;
  const completed = morrowiseTasks.filter((task) => ["done", "completed", "fixed"].includes(task.status)).length;

  return surface({
    id: "morrowise_living_system",
    label: "MorroWise 活系統",
    source_of_truth: "canonical_tasks_and_generated_project_state",
    source_files: [
      "$COLLAB/harness-mc/milestones/harness-mc/tasks.json",
      "$COLLAB/harness-mc/public/data/projects.json",
      "$COLLAB/harness-mc/public/data/task-events.json",
      "$COLLAB/harness-mc/public/data/changes.json",
    ],
    generator: ["scripts/generate-data.mjs", "scripts/generate-task-event-data.mjs", "scripts/sentinel-diff.mjs", "npm run prebuild"],
    generated_at: latest([sources.fileTimes.projects, sources.taskEvents?.generated_at, sources.changes?.generated_at]),
    stale_after_minutes: 60,
    stale_rule: "stale when generated project, event, or attention data is older than the newest canonical task/event/worktree input used by the dashboard",
    missing_sources: missingSources(sources, ["projects", "taskEvents", "changes"]),
    freshness_action: action("generator", "npm run prebuild", "Regenerate project, task-event, and attention data before trusting the MorroWise task chain."),
    next_action: nextTask
      ? action("task", nextTask.id, `${nextTask.order_label || nextTask.id}: ${nextTask.title}`)
      : action("none", null, "All current MorroWise tasks in generated project data are complete or non-actionable."),
    write_boundary: readOnlyBoundary(["summarize MorroWise task chain", "show next executable task", "link to source files"], ["change task status", "mark MorroWise autonomous", "write visual mirrors"]),
    verifier_ref: "npm run test:morrowise-live-dashboard",
    classification: "semi_live",
    attention_level: nextTask?.status === "blocked" ? "blocked" : nextTask ? "watch" : "normal",
    evidence_refs: ["$COLLAB/harness-mc/milestones/harness-mc/tasks.json", "$COLLAB/harness-mc/public/data/projects.json"],
    drilldown_route: "morrowise_living_system.drilldown",
    metrics: { tasks: morrowiseTasks.length, completed, next_task_id: nextTask?.id || null },
  });
}

function morrowiseProactiveLoopSurface(sources) {
  const proactive = sources.proactiveLoop || {};
  const summary = proactive.summary || {};
  const approvalQueue = summary.approval_queue || 0;
  const openLoops = summary.open_loop || 0;

  return surface({
    id: "morrowise_proactive_loop",
    label: "MorroWise 主動閉環",
    source_of_truth: "generated_proactive_loop_state_and_policy_registry",
    source_files: [
      "$COLLAB/harness-mc/public/data/morrowise-proactive-loop.json",
      "$COLLAB/harness-mc/system-workflow/registries/morrowise-approval-policy.json",
      "$COLLAB/harness-mc/system-workflow/docs/specs/morrowise-approval-policy.md",
    ],
    generator: ["scripts/generate-morrowise-proactive-loop.mjs", "scripts/morrowise-action-runner.mjs", "npm run prebuild"],
    generated_at: latest([proactive.generated_at, sources.fileTimes.proactiveLoop]),
    stale_after_minutes: 60,
    stale_rule: "stale when proactive-loop data predates approval policy, runner, or task-event input changes",
    missing_sources: missingSources(sources, ["proactiveLoop", "approvalPolicy"]),
    freshness_action: action("generator", "npm run prebuild", "Regenerate proactive-loop and approval-policy derived data before trusting loop state."),
    next_action: approvalQueue > 0
      ? action("approval", "approval_queue.drilldown", "Review approval-required proactive loop outputs.")
      : action("route_or_verifier", "npm run test:morrowise-loop", "Verify proactive-loop state before presenting it as operational."),
    write_boundary: {
      mode: "read_only_with_approval_policy",
      allowed: ["display recommendations", "display approval-required actions", "display runner dry-run output"],
      forbidden: ["execute approval-required actions", "commit", "push", "deploy", "external sync without approval"],
    },
    verifier_ref: "npm run test:morrowise-loop",
    classification: "semi_live",
    attention_level: approvalQueue > 0 || openLoops > 0 ? "needs_review" : "watch",
    evidence_refs: ["$COLLAB/harness-mc/public/data/morrowise-proactive-loop.json", "$COLLAB/harness-mc/system-workflow/registries/morrowise-approval-policy.json"],
    drilldown_route: "morrowise_living_system.drilldown",
    metrics: { scenarios: summary.scenarios || 0, waiting_approval: summary.waiting_approval || 0, open_loop: openLoops, approval_queue: approvalQueue },
  });
}

function taskEventPipelineSurface(sources) {
  const taskEvents = sources.taskEvents || {};
  const taskCounts = taskEvents.task_events || {};
  const syncCounts = taskEvents.sync_events || {};
  const pending = (taskCounts.pending || 0) + (syncCounts.pending || 0);
  const rejected = taskCounts.rejected || 0;
  const failed = syncCounts.failed || 0;

  return surface({
    id: "task_event_pipeline",
    label: "Task Event Pipeline",
    source_of_truth: "task_event_outbox_and_generated_event_read_model",
    source_files: [
      "$COLLAB/harness-mc/task-events/**/*.json",
      "$COLLAB/harness-mc/sync-events/**/*.json",
      "$COLLAB/harness-mc/public/data/task-events.json",
      "$COLLAB/harness-mc/task-events/latest-report.json",
    ],
    generator: ["scripts/generate-task-event-data.mjs", "scripts/apply-task-events.mjs", "npm run prebuild"],
    generated_at: latest([taskEvents.generated_at, sources.fileTimes.taskEvents]),
    stale_after_minutes: 30,
    stale_rule: "stale when pending or rejected queues change without a regenerated task-events read model, or when queue age exceeds the dashboard threshold",
    missing_sources: missingSources(sources, ["taskEvents"]),
    freshness_action: action("generator", "node scripts/generate-task-event-data.mjs", "Regenerate task-events.json before applying or syncing queue actions."),
    next_action: pending > 0 || rejected > 0 || failed > 0
      ? action("route_or_command", "task_event_pipeline.drilldown", "Inspect task and sync event queues before applying or syncing events.")
      : action("none", null, "No pending task or sync event action required."),
    write_boundary: readOnlyBoundary(["display queue counts", "link to reducer reports", "prepare review action"], ["apply events", "sync external mirrors", "overwrite task files without explicit reducer approval"]),
    verifier_ref: "npm run test:task-event-dashboard",
    classification: "semi_live",
    attention_level: failed > 0 || rejected > 0 ? "needs_review" : pending > 0 ? "watch" : "normal",
    evidence_refs: ["$COLLAB/harness-mc/public/data/task-events.json", "$COLLAB/harness-mc/task-events", "$COLLAB/harness-mc/sync-events"],
    drilldown_route: "task_event_pipeline.drilldown",
    metrics: { pending_task_events: taskCounts.pending || 0, rejected_task_events: rejected, pending_sync_events: syncCounts.pending || 0, failed_sync_events: failed },
  });
}

function visualSyncCoverageSurface(sources) {
  const coverage = sources.visualSyncCoverage || {};
  const summary = coverage.summary || {};
  const pending = summary.sync_events_pending || 0;
  const failed = summary.sync_events_failed || 0;
  const gaps = summary.coverage_gaps || 0;
  const next = coverage.next_action || {};

  return surface({
    id: "visual_sync_coverage",
    label: "Visual Sync Coverage",
    source_of_truth: "canonical_mc_tasks_and_sync_event_queues",
    source_files: [
      "$COLLAB/harness-mc/public/data/visual-sync-coverage.json",
      "$COLLAB/harness-mc/milestones/*/tasks.json",
      "$COLLAB/harness-mc/milestones/*/state.json",
      "$COLLAB/harness-mc/sync-events/**/*.json",
    ],
    generator: ["scripts/generate-visual-sync-coverage.mjs", "npm run prebuild"],
    generated_at: latest([coverage.generated_at, sources.fileTimes.visualSyncCoverage]),
    stale_after_minutes: 30,
    stale_rule: "stale when task refs or sync-events queues change without regenerated visual-sync coverage data",
    missing_sources: missingSources(sources, ["visualSyncCoverage"]),
    freshness_action: action("generator", "node scripts/generate-visual-sync-coverage.mjs", "Regenerate visual sync coverage before deciding whether Canvas or Heptabase sync is pending."),
    next_action: next.label
      ? action(next.type || "route_or_command", next.target || "visual_sync_coverage.drilldown", next.label)
      : action("none", null, "No visual sync coverage action required."),
    write_boundary: readOnlyBoundary(["display Heptabase refs", "display Canvas/sync queue gaps", "route next sync action"], ["write Heptabase", "write Obsidian Canvas", "move sync-events", "change task state"]),
    verifier_ref: "npm run test:visual-sync-coverage",
    classification: "semi_live",
    attention_level: failed > 0 ? "needs_review" : pending > 0 || gaps > 0 ? "watch" : "normal",
    evidence_refs: ["$COLLAB/harness-mc/public/data/visual-sync-coverage.json", "$COLLAB/harness-mc/sync-events"],
    drilldown_route: "visual_sync_coverage.drilldown",
    metrics: {
      tracked_tasks: summary.tracked_tasks || 0,
      aligned: summary.aligned || 0,
      coverage_gaps: gaps,
      pending_sync_events: pending,
      failed_sync_events: failed,
    },
  });
}

function worktreeStatusSurface(sources) {
  const worktrees = sources.worktrees || {};
  const summary = worktrees.summary || {};
  const uncommitted = summary.uncommitted || 0;
  const localCommits = summary.local_commits || 0;
  const needsReconcile = summary.needs_reconcile || 0;

  return surface({
    id: "worktree_status",
    label: "Worktree Status",
    source_of_truth: "local_git_status_read_model",
    source_files: ["$COLLAB/harness-mc/public/data/worktrees.json", "$COLLAB/*/.git"],
    generator: ["scripts/generate-worktree-status.mjs", "npm run prebuild"],
    generated_at: latest([worktrees.generated_at, sources.fileTimes.worktrees]),
    stale_after_minutes: 5,
    stale_rule: "stale after any file edit, commit, checkout, branch switch, pull, push, or agent handoff",
    missing_sources: missingSources(sources, ["worktrees"]),
    freshness_action: action("generator", "node scripts/generate-worktree-status.mjs", "Regenerate worktree status after edits, commits, checkouts, pushes, or handoff."),
    next_action: uncommitted > 0
      ? action("command_or_policy", "worktree-commit", "Use the commit gate before committing, pushing, or marking work closed.")
      : action("none", null, "No dirty worktree action required from the generated worktree status."),
    write_boundary: {
      mode: "read_only_commit_gate",
      allowed: ["display dirty files", "display local commits", "suggest commit grouping"],
      forbidden: ["commit", "push", "rebase", "reset", "delete files", "rewrite history"],
    },
    verifier_ref: "npm run test:worktree-status",
    classification: "semi_live",
    attention_level: needsReconcile > 0 ? "blocked" : uncommitted > 0 || localCommits > 0 ? "needs_review" : "normal",
    evidence_refs: ["$COLLAB/harness-mc/public/data/worktrees.json"],
    drilldown_route: "worktree_status.drilldown",
    metrics: { scanned: summary.scanned || 0, uncommitted, local_commits: localCommits, needs_reconcile: needsReconcile },
  });
}

function closeoutResidualLedgerSurface(sources) {
  const ledger = sources.closeoutResidualLedger || {};
  const summary = ledger.summary || {};
  const residualCount = summary.residual_count || 0;
  const blockedCount = (summary.repositories_behind || 0) + (summary.repositories_diverged || 0) + (summary.missing_next_anchor || 0);

  return surface({
    id: "closeout_residual_ledger",
    label: "Closeout Residual Ledger",
    source_of_truth: "generated_closeout_residual_read_model",
    source_files: [
      "$COLLAB/harness-mc/public/data/closeout-residual-ledger.json",
      "$COLLAB/harness-mc/public/data/commit-attention.json",
      "$COLLAB/harness-mc/public/data/worktrees.json",
      "$COLLAB/harness-mc/public/data/commit-cleanup-plan.json",
      "$COLLAB/harness-mc/public/data/task-events.json",
      "$COLLAB/harness-mc/milestones/*/tasks.json",
    ],
    generator: ["scripts/generate-closeout-residual-ledger.mjs", "npm run prebuild"],
    generated_at: latest([ledger.generated_at, sources.fileTimes.closeoutResidualLedger]),
    stale_after_minutes: 5,
    stale_rule: "stale after cc-log, worktree-commit, task-event reducer runs, file edits, commits, checkouts, pushes, or agent handoff",
    missing_sources: missingSources(sources, ["closeoutResidualLedger"]),
    freshness_action: action("generator", "node scripts/generate-closeout-residual-ledger.mjs", "Regenerate residual ledger after closeout, commit, task-event, or handoff activity."),
    next_action: ledger.next_action || action("none", null, "No residual closeout action required."),
    write_boundary: readOnlyBoundary(
      ["display closeout residuals", "route next_action to existing gates", "show missing evidence and pending event counts"],
      ["commit", "push", "apply task events", "mutate task state", "close task", "send external notification"],
    ),
    verifier_ref: "npm run test:closeout-residual-ledger",
    classification: "semi_live",
    attention_level: blockedCount > 0 ? "blocked" : residualCount > 0 ? "needs_review" : "normal",
    evidence_refs: ["$COLLAB/harness-mc/public/data/closeout-residual-ledger.json"],
    drilldown_route: "worktree_status.drilldown",
    metrics: {
      residual_count: residualCount,
      repositories_dirty: summary.repositories_dirty || 0,
      pending_task_events: summary.pending_task_events || 0,
      cleanup_plan_leftovers: summary.cleanup_plan_leftovers || 0,
      completed_without_commit_evidence: summary.completed_without_commit_evidence || 0,
      next_action_type: ledger.next_action?.type || null,
    },
  });
}

function capabilityRegistrySurface(sources) {
  const capabilities = sources.capabilities || {};
  const summary = capabilities.summary || {};
  const needsAttention = summary.needs_attention || 0;
  const total = summary.total || 0;

  return surface({
    id: "api_cli_mcp_capabilities",
    label: "API / CLI / MCP capabilities",
    source_of_truth: "morrowise_capability_registry_and_generated_read_model",
    source_files: [
      "$COLLAB/harness-mc/system-workflow/registries/morrowise-api-cli-mcp-capability-registry.json",
      "$COLLAB/harness-mc/public/data/morrowise-capabilities.json",
      "$COLLAB/harness-mc/AGENTS.md",
    ],
    generator: ["scripts/generate-morrowise-capabilities.mjs", "npm run prebuild"],
    generated_at: latest([capabilities.generated_at, sources.fileTimes.capabilities]),
    stale_after_minutes: 60,
    stale_rule: "stale when API / CLI / MCP registry history changes without regenerating morrowise-capabilities.json, or when local runtime probes are unresolved during active capability work",
    missing_sources: missingSources(sources, ["capabilities"]),
    freshness_action: action("generator", "node scripts/generate-morrowise-capabilities.mjs", "Regenerate capability read model before trusting API / CLI / MCP status."),
    next_action: needsAttention > 0
      ? action("task", "api-cli-mcp-capability-registry-v0", "Review blocked, legacy, or unknown API / CLI / MCP capabilities.")
      : action("none", null, "All tracked API / CLI / MCP capabilities are ready or only need monitoring."),
    write_boundary: readOnlyBoundary(
      ["display capability status", "display latest history", "route next_action to owner task"],
      ["execute CLI", "call external API", "invoke MCP tools", "read secrets", "write task state"],
    ),
    verifier_ref: "npm run test:capability-registry",
    classification: "semi_live",
    attention_level: needsAttention > 0 ? "needs_review" : "normal",
    evidence_refs: [
      "$COLLAB/harness-mc/system-workflow/registries/morrowise-api-cli-mcp-capability-registry.json",
      "$COLLAB/harness-mc/public/data/morrowise-capabilities.json",
      "$COLLAB/harness-mc/AGENTS.md",
    ],
    drilldown_route: "api_cli_mcp_capabilities.drilldown",
    metrics: { total, needs_attention: needsAttention, by_status: summary.by_status || {}, by_type: summary.by_type || {} },
  });
}

function approvalQueueSurface(sources) {
  const approvals = buildApprovalQueue(sources);
  return surface({
    id: "approval_queue",
    label: "Approval Queue",
    source_of_truth: "approval_policy_and_generated_approval_requests",
    source_files: [
      "$COLLAB/harness-mc/system-workflow/registries/morrowise-approval-policy.json",
      "$COLLAB/harness-mc/system-workflow/docs/specs/morrowise-approval-policy.md",
      "$COLLAB/harness-mc/public/data/morrowise-proactive-loop.json",
    ],
    generator: ["scripts/generate-morrowise-proactive-loop.mjs", "scripts/morrowise-action-runner.mjs", "npm run prebuild"],
    generated_at: latest([sources.proactiveLoop?.generated_at, sources.fileTimes.proactiveLoop, sources.fileTimes.approvalPolicy]),
    stale_after_minutes: 60,
    stale_rule: "stale when approval policy, pending request payload, runner output, or task-event queue changes without regeneration",
    missing_sources: missingSources(sources, ["proactiveLoop", "approvalPolicy"]),
    freshness_action: action("generator", "npm run prebuild", "Regenerate proactive-loop and approval policy data before acting on approval requests."),
    next_action: approvals.length > 0
      ? action("approval", "approval_queue.drilldown", "Review exact requested action, destination, owner, age, payload preview, and closure condition before approval.")
      : action("none", null, "No approval request is pending in the generated proactive loop data."),
    write_boundary: {
      mode: "approval_required",
      allowed: ["display pending approvals", "display policy reason", "prepare an approval request"],
      forbidden: ["approve on Vincent's behalf", "execute external writes", "commit or push without commit gate approval"],
    },
    verifier_ref: "npm run test:morrowise-approval",
    classification: "semi_live",
    attention_level: approvals.length > 0 ? "needs_review" : "normal",
    evidence_refs: ["$COLLAB/harness-mc/public/data/morrowise-proactive-loop.json", "$COLLAB/harness-mc/system-workflow/registries/morrowise-approval-policy.json"],
    drilldown_route: "approval_queue.drilldown",
    metrics: { pending_approvals: approvals.length },
  });
}

function surface(input) {
  const freshness = evaluateFreshness(input);
  const shouldRepair = freshness.state === "stale" || freshness.state === "degraded";

  return {
    ...input,
    last_updated_at: input.generated_at || null,
    freshness_state: freshness.state,
    freshness_reason: freshness.reason,
    freshness_checked_at: new Date().toISOString(),
    next_action: shouldRepair && input.freshness_action ? input.freshness_action : input.next_action,
    open_loops: input.open_loops || [],
  };
}

function buildSummary(surfaces, sources) {
  const attentionRank = { normal: 0, watch: 1, needs_review: 2, blocked: 3 };
  const highest = surfaces.reduce((current, item) => attentionRank[item.attention_level] > attentionRank[current] ? item.attention_level : current, "normal");
  const primary = surfaces.find((item) => item.attention_level === highest && item.next_action?.type !== "none")?.next_action || null;

  return {
    overall_freshness_state: summarizeFreshness(surfaces),
    highest_attention_level: highest,
    primary_next_action: primary,
    approval_wait_count: buildApprovalQueue(sources).length,
    stale_surface_count: surfaces.filter((item) => item.freshness_state === "stale").length,
    degraded_surface_count: surfaces.filter((item) => item.freshness_state === "degraded").length,
    source_counts: {
      projects: Array.isArray(sources.projects) ? sources.projects.length : 0,
      task_events_pending: sources.taskEvents?.task_events?.pending || 0,
      sync_events_pending: sources.taskEvents?.sync_events?.pending || 0,
      worktree_repos_scanned: sources.worktrees?.summary?.scanned || 0,
      closeout_residuals: sources.closeoutResidualLedger?.summary?.residual_count || 0,
      proactive_scenarios: sources.proactiveLoop?.summary?.scenarios || 0,
      capabilities: sources.capabilities?.summary?.total || 0,
      loop_chain: Array.isArray(sources.proactiveLoop?.scenarios) ? sources.proactiveLoop.scenarios.length : 0,
    },
  };
}

function buildLoopChain(sources) {
  const scenarios = Array.isArray(sources.proactiveLoop?.scenarios) ? sources.proactiveLoop.scenarios : [];
  return scenarios.map((scenario) => ({
    id: scenario.scenario_id,
    source_surface_id: "morrowise_proactive_loop",
    status: scenario.status,
    read_only: true,
    stages: {
      trigger: scenario.trigger,
      recommendation: scenario.recommendation,
      approval: scenario.approval,
      action: scenario.action,
      feedback: scenario.feedback,
    },
    runner_output: scenario.runner_output,
    evidence_refs: scenario.recommendation?.evidence_refs || [],
    write_boundary: "Dashboard can display this loop chain only. Approval-required, forbidden, commit, push, deploy, task mutation, and external writes are not executed from the dashboard.",
  }));
}

export function evaluateSurfaceFreshness(input, now = new Date()) {
  if (Array.isArray(input.missing_sources) && input.missing_sources.length > 0) {
    return {
      state: "degraded",
      reason: `Missing required source data: ${input.missing_sources.join(", ")}.`,
    };
  }

  if (!input.generated_at) {
    return {
      state: "unknown",
      reason: "No generated_at or file timestamp is available for this surface.",
    };
  }

  if (!input.stale_after_minutes) {
    return {
      state: "fresh",
      reason: "Generated timestamp exists and no stricter stale threshold is configured.",
    };
  }

  const generatedAtMs = new Date(input.generated_at).getTime();
  if (!Number.isFinite(generatedAtMs)) {
    return {
      state: "unknown",
      reason: `Invalid generated_at timestamp: ${input.generated_at}.`,
    };
  }

  const ageMinutes = Math.floor((now.getTime() - generatedAtMs) / ONE_MINUTE);
  if (ageMinutes > input.stale_after_minutes) {
    return {
      state: "stale",
      reason: `Last updated ${ageMinutes} minutes ago; threshold is ${input.stale_after_minutes} minutes.`,
    };
  }

  return {
    state: "fresh",
    reason: `Last updated ${ageMinutes} minutes ago; threshold is ${input.stale_after_minutes} minutes.`,
  };
}

function evaluateFreshness(input) {
  return evaluateSurfaceFreshness(input);
}

function summarizeFreshness(surfaces) {
  if (surfaces.some((item) => item.freshness_state === "degraded")) return "degraded";
  if (surfaces.some((item) => item.freshness_state === "stale")) return "stale";
  if (surfaces.some((item) => item.freshness_state === "unknown")) return "unknown";
  return "fresh";
}

function missingSources(sources, keys) {
  return keys.filter((key) => !sources[key]);
}

function buildRoutes() {
  return [
    route("surface.system_attention.drilldown", "System Attention details", ["system_attention"], "/attention", ["stale", "blocked", "queue", "evidence_refs"]),
    route("morrowise_living_system.drilldown", "MorroWise living system details", ["morrowise_living_system", "morrowise_proactive_loop"], "/morrowise", ["task_chain", "open_loops", "trigger_recommendation_approval_action_feedback"]),
    route("task_event_pipeline.drilldown", "Task Event Pipeline details", ["task_event_pipeline"], "/task-events", ["pending", "applied", "rejected", "sync_events", "reducer_report"]),
    route("worktree_status.drilldown", "Worktree Status details", ["worktree_status"], "/worktrees", ["dirty_files", "local_commits", "remote_divergence", "commit_gate"]),
    route("api_cli_mcp_capabilities.drilldown", "API / CLI / MCP capability details", ["api_cli_mcp_capabilities"], "/capabilities", ["status", "latest_history", "boundary", "owner_task", "next_action"]),
    route("approval_queue.drilldown", "Approval Queue details", ["approval_queue"], "/approvals", ["requested_action", "destination", "owner", "age", "payload_preview", "closure_condition"]),
  ];
}

function buildApprovalQueue(sources) {
  const scenarios = Array.isArray(sources.proactiveLoop?.scenarios) ? sources.proactiveLoop.scenarios : [];
  return scenarios
    .filter((scenario) => scenario.approval?.requires_approval || scenario.action?.output_type === "approval_request")
    .map((scenario) => {
      const request = scenario.runner_output?.approval_request || {};
      return {
        id: scenario.recommendation?.recommendation_id || scenario.scenario_id,
        source_surface_id: "morrowise_proactive_loop",
        action_class: scenario.action?.action_class || "unknown",
        requested_action: request.suggested_action || scenario.recommendation?.suggested_action || "",
        destination: scenario.feedback?.destination || request.suggested_task_id || "",
        owner: "Vincent",
        created_at: sources.proactiveLoop?.generated_at || sources.fileTimes.proactiveLoop || null,
        age_label: "generated read model item",
        payload_preview: safePayloadPreview(scenario),
        policy_ref: "$COLLAB/harness-mc/system-workflow/registries/morrowise-approval-policy.json",
        closure_condition: "Vincent explicitly approves or rejects the exact requested action.",
        write_boundary: "Approval is required before execution; dashboard display is read-only.",
      };
    });
}

function buildCompletionGate(sources) {
  const harnessRepo = (sources.worktrees?.repositories || []).find((repo) => repo.repo === "harness-mc");
  const dirtyCount = harnessRepo ? harnessRepo.staged_count + harnessRepo.unstaged_count + harnessRepo.untracked_count : 0;
  const state = dirtyCount > 0 || (harnessRepo?.local_commits_count || 0) > 0 ? "required_pending" : "not_required";

  return {
    worktree_commit: {
      state,
      skill_ref: "$COLLAB/notyet-harness/000_Agent/skills/worktree-commit/SKILL.md",
      required_before_verification_result: true,
      required_evidence: [
        "repo",
        "task_id",
        "dirty_tree_scan",
        "grouped_scope",
        "full_diff_review",
        "4c_review",
        "local_check_output",
        "path_policy_check",
        "commit_message",
        "vincent_confirmation",
        "commit_hash_or_blocker",
      ],
      repo: "harness-mc",
      task_id: "morrowise-live-dashboard-real-data-flow",
      grouped_scope: null,
      local_checks: [],
      path_policy_check: null,
      four_c_review: null,
      vincent_confirmation_state: "not_requested",
      commit_hash: null,
      blocker: state === "required_pending" ? "Generated worktree status reports local commits or dirty files; run worktree-commit before final closure." : null,
    },
  };
}

function route(id, label, surfaceIds, routePath, requiredFields) {
  return {
    id,
    label,
    surface_ids: surfaceIds,
    route: routePath,
    required_fields: requiredFields,
    write_boundary: "read_only",
  };
}

function action(type, target, label) {
  return { type, target, label };
}

function readOnlyBoundary(allowed, forbidden) {
  return { mode: "read_only", allowed, forbidden };
}

function findProject(projects, projectId) {
  return Array.isArray(projects) ? projects.find((project) => project.project === projectId) : null;
}

function safePayloadPreview(scenario) {
  const payload = scenario.runner_output?.approval_request || scenario.recommendation || {};
  return JSON.stringify(payload).slice(0, 280);
}

function latest(values) {
  const timestamps = values.filter(Boolean).map((value) => new Date(value).getTime()).filter((value) => Number.isFinite(value));
  if (timestamps.length === 0) return null;
  return new Date(Math.max(...timestamps)).toISOString();
}

function fileGeneratedAt(root, relativePath) {
  const fullPath = path.join(root, relativePath);
  if (!fs.existsSync(fullPath)) return null;
  return fs.statSync(fullPath).mtime.toISOString();
}

function readJsonOrNull(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isCli) generateMorrowiseLiveDashboard();
