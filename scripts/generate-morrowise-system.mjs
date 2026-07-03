import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outPath = path.join(root, "public", "data", "morrowise-system.json");
const DONE_STATUSES = new Set(["completed", "done", "cancelled", "canceled"]);
const ACTIVE_STATUSES = new Set(["todo", "in_progress", "doing", "blocked"]);

const PATHS = {
  rootAgents: "$COLLAB/AGENTS.md",
  core: "$COLLAB/notyet-harness/000_Agent/CORE.md",
  harnessAgents: "$COLLAB/harness-mc/AGENTS.md",
  morrowiseTasks: "$COLLAB/harness-mc/milestones/morrowise/tasks.json",
  allTasks: "$COLLAB/harness-mc/milestones/*/tasks.json",
  projects: "$COLLAB/harness-mc/public/data/projects.json",
  taskEvents: "$COLLAB/harness-mc/public/data/task-events.json",
  worktrees: "$COLLAB/harness-mc/public/data/worktrees.json",
  liveDashboard: "$COLLAB/harness-mc/public/data/morrowise-live-dashboard.json",
  capabilities: "$COLLAB/harness-mc/public/data/morrowise-capabilities.json",
  residualLedger: "$COLLAB/harness-mc/public/data/closeout-residual-ledger.json",
  proactiveLoop: "$COLLAB/harness-mc/public/data/morrowise-proactive-loop.json",
  auditorSchema: "$COLLAB/harness-mc/system-workflow/schemas/morrowise-auditor.schema.json",
  auditorReadModel: "$COLLAB/harness-mc/public/data/morrowise-auditor.json",
  systemSchema: "$COLLAB/harness-mc/system-workflow/schemas/morrowise-system.schema.json",
  sourceMapReconcile: "$COLLAB/harness-mc/system-workflow/docs/specs/morrowise-source-map-reconciliation.md",
  architectureReport: "$COLLAB/notyet-harness/000_Agent/docs/morrowise/reports/architecture-pulse-2026-06-27.md",
  admissionRegistry: "$COLLAB/harness-mc/system-workflow/registries/morrowise-live-system-admission.json",
  approvalPolicy: "$COLLAB/harness-mc/system-workflow/registries/morrowise-approval-policy.json",
  triggerRules: "$COLLAB/harness-mc/system-workflow/registries/morrowise-trigger-rules.json",
  realityTaxGate: "$COLLAB/harness-mc/system-workflow/registries/morrowise-reality-tax-gate.json",
  realityTaxProtocol: "$COLLAB/notyet-harness/000_Agent/docs/morrowise/reality-tax-gate-protocol.md",
  capabilityRegistry: "$COLLAB/harness-mc/system-workflow/registries/morrowise-api-cli-mcp-capability-registry.json",
  wiringGate: "$COLLAB/harness-mc/system-workflow/registries/morrowise-wiring-gate.json",
  commitPlanningGate: "$COLLAB/harness-mc/system-workflow/registries/morrowise-commit-planning-gate.json",
  generator: "$COLLAB/harness-mc/scripts/generate-morrowise-system.mjs",
  verifier: "$COLLAB/harness-mc/scripts/verify-morrowise-system-json.mjs",
};

export function generateMorroWiseSystem(options = {}) {
  const repoRoot = options.root || root;
  const generatedAt = options.generatedAt || new Date().toISOString();
  const morrowiseProject = options.morrowiseProject ?? readJson(repoRoot, "milestones/morrowise/tasks.json");
  const projects = options.projects ?? readJsonOrNull(repoRoot, "public/data/projects.json");
  const taskEvents = options.taskEvents ?? readJsonOrNull(repoRoot, "public/data/task-events.json");
  const worktrees = options.worktrees ?? readJsonOrNull(repoRoot, "public/data/worktrees.json");
  const liveDashboard = options.liveDashboard ?? readJsonOrNull(repoRoot, "public/data/morrowise-live-dashboard.json");
  const capabilities = options.capabilities ?? readJsonOrNull(repoRoot, "public/data/morrowise-capabilities.json");
  const residualLedger = options.residualLedger ?? readJsonOrNull(repoRoot, "public/data/closeout-residual-ledger.json");
  const proactiveLoop = options.proactiveLoop ?? readJsonOrNull(repoRoot, "public/data/morrowise-proactive-loop.json");
  const auditorReport = options.auditorReport === undefined ? readJsonOrNull(repoRoot, "public/data/morrowise-auditor.json") : options.auditorReport;
  const admission = options.admission ?? readJson(repoRoot, "system-workflow/registries/morrowise-live-system-admission.json");
  const approval = options.approval ?? readJson(repoRoot, "system-workflow/registries/morrowise-approval-policy.json");
  const triggers = options.triggers ?? readJson(repoRoot, "system-workflow/registries/morrowise-trigger-rules.json");
  const realityTaxGate = options.realityTaxGate ?? readJson(repoRoot, "system-workflow/registries/morrowise-reality-tax-gate.json");
  const capabilityRegistry = options.capabilityRegistry ?? readJson(repoRoot, "system-workflow/registries/morrowise-api-cli-mcp-capability-registry.json");
  const wiringGate = options.wiringGate ?? readJson(repoRoot, "system-workflow/registries/morrowise-wiring-gate.json");
  const commitPlanningGate = options.commitPlanningGate ?? readJson(repoRoot, "system-workflow/registries/morrowise-commit-planning-gate.json");

  const tasks = morrowiseProject.tasks || [];
  const taskCounts = countBy(tasks, (task) => task.status || "unknown");
  const openTasks = tasks.filter((task) => !DONE_STATUSES.has(task.status));
  const nextTask = selectNextTask(tasks);
  const staleSurfaces = (liveDashboard?.surfaces || []).filter((surface) => surface.freshness_state === "stale");
  const pendingEvents = taskEvents?.task_events?.pending || 0;
  const residualCount = residualLedger?.summary?.residual_count || 0;

  const data = {
    schema_version: "morrowise-system.v0",
    generated_at: generatedAt,
    source_of_truth: buildSourceOfTruth(),
    portable_agent_verification: buildPortableAgentVerification(),
    dna: buildDna(),
    memory: buildMemory({ tasks, taskCounts, residualLedger, nextTask }),
    senses: buildSenses({ generatedAt, triggers, taskEvents, liveDashboard, staleSurfaces, pendingEvents }),
    muscles: buildMuscles({ capabilities, capabilityRegistry, proactiveLoop }),
    immune: buildImmune({ approval }),
    heartbeat: buildHeartbeat({ realityTaxGate }),
    feedback: buildFeedback({ admission, wiringGate, commitPlanningGate, realityTaxGate, taskEvents, proactiveLoop, approval }),
    open_loops: buildOpenLoops({
      openTasks,
      nextTask,
      pendingEvents,
      staleSurfaces,
      residualCount,
      capabilities,
      projects,
      generatedAt,
      auditorReport,
    }),
  };

  if (options.write !== false) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(data, null, 2)}\n`);
    console.log(
      `Generated ${outPath} — ${tasks.length} MorroWise tasks, ${data.open_loops.length} open loops`,
    );
  }

  return data;
}

function buildSourceOfTruth() {
  return {
    collab_root: "$COLLAB",
    canonical_task_state: [PATHS.morrowiseTasks, PATHS.allTasks],
    generated_data: [
      PATHS.projects,
      PATHS.taskEvents,
      PATHS.worktrees,
      PATHS.liveDashboard,
      PATHS.capabilities,
      PATHS.residualLedger,
      PATHS.proactiveLoop,
      "$COLLAB/harness-mc/public/data/morrowise-system.json",
    ],
    visual_layers: [
      { name: "MC dashboard", role: "dashboard", may_close_task: false },
      { name: "Heptabase", role: "external_surface", may_close_task: false },
      { name: "Obsidian Canvas", role: "mirror", may_close_task: false },
      { name: "Generated read models", role: "read_model", may_close_task: false },
    ],
    docs_are: "routing_and_decision_evidence",
  };
}

function buildPortableAgentVerification() {
  return {
    principle: "Data belongs to Vincent; AI agents are replaceable executors.",
    entry_chain: [PATHS.rootAgents, PATHS.core, PATHS.harnessAgents, PATHS.morrowiseTasks],
    work_anchor_required: true,
    required_checks: [
      check("work-anchor-preflight", "node scripts/work-anchor-preflight.mjs --project morrowise --task-id <task>", "before implementation", "result: allow"),
      check("morrowise-system-json", "npm run test:morrowise-system-json", "MorroWise system read model", "verification OK"),
      check("task-validation", "node scripts/validate-tasks.mjs --changed-only --project morrowise", "MorroWise task state", "0 issues"),
      check("path-policy", "rg -n '/Users/[a-zA-Z]+/' changed shared files", "commit scope", "no hardcoded local collaboration path"),
    ],
    handoff_evidence: ["task_id", "done_condition", "changed_files", "verification_output", "commit_hash", "task_summary", "next_task"],
  };
}

function buildDna() {
  return {
    system_name: "MorroWise",
    identity: "A portable control-plane read model for Vincent's agent workflows, source-of-truth routing, gates, generated data, and open loops.",
    boundaries: [
      "tasks.json and registries are canonical; docs and dashboards are routing evidence or surfaces.",
      "Generated read models are read-only and must be regenerated from canonical inputs.",
      "External mirrors cannot close tasks or overwrite MC canonical state.",
      "Commit, push, deploy, external sync, and schedule mutation remain approval-gated.",
    ],
    non_goals: [
      "Do not become a second architecture document.",
      "Do not read secrets, browser cookies, runtime auth files, or external mirror content as source of truth.",
      "Do not execute autonomous side effects from generated read models.",
    ],
  };
}

function buildMemory({ tasks, taskCounts, residualLedger, nextTask }) {
  const completedCount = (taskCounts.completed || 0) + (taskCounts.done || 0);
  return {
    context: [
      contextRef("morrowise-task-state", sourceRef("task", `${PATHS.morrowiseTasks}#tasks`), `MorroWise currently tracks ${tasks.length} tasks; ${completedCount} completed, ${taskCounts.todo || 0} todo, ${(taskCounts.in_progress || 0)} in progress.`),
      contextRef("source-map-reconciliation", sourceRef("file", PATHS.sourceMapReconcile), "Source-map families are mapped to MC specs, registries, generated data, and known gaps."),
      contextRef("auditor-loop", sourceRef("file", PATHS.architectureReport), "Architecture Pulse report and auditor schema provide document drift input for the system generator."),
      contextRef("next-anchor", sourceRef("task", `${PATHS.morrowiseTasks}#${nextTask?.id || "none"}`), nextTask ? `Next executable MorroWise task is ${nextTask.id}.` : "No executable MorroWise task selected."),
    ],
    evidence_tags: ["tasks_json", "registries", "generated_read_models", "verifiers", "open_loops"],
    commit_boundaries: [
      {
        task_id: "morrowise-system-json-generator-v0",
        status: "open_loop",
        changed_files: [
          "scripts/generate-morrowise-system.mjs",
          "scripts/verify-morrowise-system-json.mjs",
          "public/data/morrowise-system.json",
        ],
        verification: [
          check("system-json-verifier", "npm run test:morrowise-system-json", "generated read model", "must pass before task closeout"),
        ],
      },
      {
        task_id: "auditor-json-read-model-schema",
        status: "committed",
        changed_files: [
          "system-workflow/schemas/morrowise-auditor.schema.json",
          "scripts/verify-morrowise-auditor-schema.mjs",
        ],
        commit: "6fa4314",
        verification: [
          check("auditor-schema", "npm run test:morrowise-auditor", "auditor schema", "verification OK"),
        ],
      },
    ],
    dirty_work: (residualLedger?.repositories || []).slice(0, 8).map((repo) => ({
      repo: repo.repo,
      paths: (repo.files_sample || []).slice(0, 6),
      classification: repo.candidate_task_anchor ? "needs_triage" : "unrelated_dirty",
    })),
  };
}

function buildSenses({ generatedAt, triggers, taskEvents, liveDashboard, staleSurfaces, pendingEvents }) {
  return {
    triggers: (triggers.triggers || []).map((trigger) => ({
      trigger_id: trigger.trigger_id,
      condition: trigger.condition,
      gate_id: trigger.output_event?.target || "morrowise-recommendation-engine-v0",
      cooldown: trigger.cooldown || "unknown",
    })),
    events: (taskEvents?.recent_task_events || []).slice(0, 12).map((event) => ({
      event_id: event.id,
      type: event.type,
      status: event.queue || "pending",
      source: sourceRef("event", `$COLLAB/harness-mc/task-events/${event.queue || "pending"}/${event.file}`),
    })),
    visual_sync_gaps: staleSurfaces.slice(0, 10).map((surface) => ({
      task_id: surface.id,
      layer: "MC dashboard",
      condition: surface.freshness_reason || "Surface is stale or has missing generated inputs.",
      next_action: surface.next_action?.target || surface.freshness_action?.target || "npm run prebuild",
    })),
    freshness: {
      generated_at: generatedAt,
      degraded: staleSurfaces.length > 0 || pendingEvents > 0,
      reason: staleSurfaces.length > 0
        ? `${staleSurfaces.length} dashboard surfaces are stale; regenerate upstream data before treating surfaces as fresh.`
        : "Generated from current local read models.",
    },
  };
}

function buildMuscles({ capabilities, capabilityRegistry, proactiveLoop }) {
  const capabilityItems = capabilities?.capabilities || capabilityRegistry.capabilities || [];
  const runnerOutputs = proactiveLoop?.runner?.outputs || [];
  return {
    agents: [
      { id: "codex", role: "implementation_and_verification_agent", source: sourceRef("file", PATHS.harnessAgents) },
      { id: "claude-code", role: "parallel_consumer_of_shared_collab_state", source: sourceRef("file", PATHS.core) },
      { id: "future_agent", role: "portable_executor_using_entry_chain_and_work_anchor", source: sourceRef("file", PATHS.rootAgents) },
    ],
    tools: capabilityItems.map((capability) => ({
      id: capability.id,
      role: `${capability.type || "tool"}:${capability.status || "unknown"}`,
      source: sourceRef("file", PATHS.capabilityRegistry),
    })),
    actions: runnerOutputs.slice(0, 8).map((output) => ({
      action_id: output.recommendation_id,
      kind: output.action_class || output.suggested_action,
      approval_required: output.policy === "approval_required",
      risk_level: normalizeRisk(output.risk_level),
      runner_output: normalizeRunnerOutput(output.output_type),
    })),
  };
}

function buildImmune({ approval }) {
  const rules = [];
  for (const tier of approval.policy_tiers || []) {
    for (const rule of tier.rules || []) {
      rules.push({
        action_class: rule.action_class,
        policy: normalizePolicy(tier.policy),
        reason: rule.reason,
        required_evidence: rule.required_evidence || rule.conditions || [],
      });
    }
  }

  return {
    validators: [
      check("tasks", "node scripts/validate-tasks.mjs --changed-only --project morrowise", "canonical task state", "0 issues"),
      check("system-schema", "npm run test:morrowise-schema", "MorroWise system schema", "schema verification OK"),
      check("system-read-model", "npm run test:morrowise-system-json", "generated MorroWise system read model", "verification OK"),
      check("live-admission", "npm run test:live-system-admission", "admission registry", "verification OK"),
      check("wiring", "npm run test:morrowise-wiring", "wiring gate", "verification OK"),
    ],
    security_boundaries: [
      approval.core_rules?.secret_boundary || "Do not read or output secrets.",
      approval.core_rules?.external_effect_rule || "External writes require explicit approval.",
      approval.core_rules?.commit_boundary_rule || "Commit/push/deploy require worktree-commit and approval gates.",
      "Generated read models must be read-only and must not close tasks.",
    ],
    approval_policy: rules.slice(0, 20),
  };
}

function buildHeartbeat({ realityTaxGate }) {
  return {
    schedules: [
      { schedule_id: "commit-attention-sweep", source: sourceRef("file", "$COLLAB/notyet-harness/schedule/tasks/commit-attention-sweep.yaml"), status: "active" },
      { schedule_id: "runtime-scheduler-v0", source: sourceRef("task", `${PATHS.morrowiseTasks}#runtime-scheduler-v0`), status: "pending" },
      { schedule_id: "reality-tax-daily-review", source: sourceRef("task", `${PATHS.morrowiseTasks}#reality-tax-daily-review-task`), status: "pending" },
      { schedule_id: "reality-tax-gate", source: sourceRef("file", PATHS.realityTaxGate), status: realityTaxGate.status || "protocol_ready" },
    ],
    review_cadence: [
      { cadence_id: "session-closeout", interval: "each session closeout", gate_id: "closeout-residual-ledger" },
      { cadence_id: "weekly-review", interval: "weekly", gate_id: "morrowise.weekly_review" },
    ],
    stale_rules: [
      { rule_id: "generated-read-model-stale", condition: "Generated data predates task, registry, event, or worktree changes.", gate_id: "morrowise-system-json-generator-v0" },
      { rule_id: "pending-task-events", condition: "Task events remain pending after closeout.", gate_id: "apply_task_events" },
      { rule_id: "dashboard-stale", condition: "Dashboard surface exceeds stale_after_minutes.", gate_id: "morrowise-live-dashboard" },
      { rule_id: "reality-tax-gate", condition: `Same concept is discussed for ${realityTaxGate.trigger?.same_concept_minutes || 30} minutes without a ${realityTaxGate.trigger?.requires_output_within_hours || 24}-hour output.`, gate_id: "morrowise-reality-tax-gate" },
    ],
  };
}

function buildFeedback({ admission, wiringGate, commitPlanningGate, realityTaxGate, taskEvents, proactiveLoop, approval }) {
  const taskEventRefs = (taskEvents?.recent_task_events || []).slice(0, 12).map((event) => ({
    event_id: event.id,
    type: event.type,
    status: event.queue || "pending",
    source: sourceRef("event", `$COLLAB/harness-mc/task-events/${event.queue || "pending"}/${event.file}`),
  }));

  const recommendations = (proactiveLoop?.scenarios || []).map((scenario) => ({
    recommendation_id: scenario.recommendation?.recommendation_id || scenario.scenario_id,
    trigger_id: scenario.trigger?.trigger_id || "unknown",
    reason: scenario.recommendation?.reason || scenario.label || "Generated proactive-loop scenario.",
    suggested_action: scenario.recommendation?.suggested_action || "review",
    suggested_task_id: scenario.recommendation?.suggested_task_id || "morrowise-system-json-generator-v0",
    evidence_refs: normalizeEvidenceRefs(scenario.recommendation?.evidence_refs || []),
    risk_level: normalizeRisk(scenario.approval?.risk_level || scenario.trigger?.risk_level),
    requires_approval: Boolean(scenario.approval?.requires_approval),
    hc_refs: scenario.recommendation?.hc_refs || ["#systemDynamics"],
    hc_reasoning: scenario.recommendation?.hc_reasoning || "Generated read model preserves recommendation evidence without executing side effects.",
    hc_confidence: scenario.recommendation?.hc_confidence ?? 0.7,
  }));

  const approvalWaiting = (proactiveLoop?.runner?.outputs || [])
    .filter((output) => output.policy === "approval_required")
    .map((output) => ({
      approval_id: output.recommendation_id,
      action_class: output.action_class || output.suggested_action,
      requested_by: "morrowise-action-runner.v0",
      status: "waiting",
    }));

  return {
    gates: [
      ...((admission.components || []).map((component) => gateFromComponent(component))),
      gateFromRegistry("morrowise-wiring-gate", PATHS.wiringGate, wiringGate.status || "formal_registry"),
      gateFromRegistry("morrowise-commit-planning-gate", PATHS.commitPlanningGate, commitPlanningGate.status || "formal_registry"),
      gateFromRegistry("morrowise-reality-tax-gate", PATHS.realityTaxGate, realityTaxGate.status || "protocol_ready"),
      gateFromRegistry("morrowise-approval-policy", PATHS.approvalPolicy, approval.status || "formal_policy"),
    ],
    task_events: taskEventRefs,
    recommendation_candidates: recommendations,
    approval_waiting: approvalWaiting,
  };
}

function buildOpenLoops({ openTasks, nextTask, pendingEvents, staleSurfaces, residualCount, capabilities, projects, generatedAt, auditorReport }) {
  const loops = [];
  loops.push(openLoop({
    loop_id: "unknown-local-runtime-boundary",
    gate_id: "morrowise-system-json-generator-v0",
    source: sourceRef("file", PATHS.sourceMapReconcile),
    condition: "unknown: local runtime boundary is metadata-only until safe probes exist; no token, cookie, browser auth, or runtime auth content may be read.",
    risk_level: "medium",
    suggested_next_action: "Keep local runtime items as open loops until a safe probe contract exists.",
    owner: "future_agent",
    evidence_refs: [sourceRef("file", PATHS.sourceMapReconcile)],
    review_after: generatedAt,
  }));
  // Auditor loops are conditional on reality: once public/data/morrowise-auditor.json
  // exists, the schema-without-generator and manual-only conditions are resolved and
  // must not be reported (frozen open loops are the same rot as frozen verifiers).
  if (!auditorReport) {
    loops.push(openLoop({
      loop_id: "generator-missing-auditor-json",
      gate_id: "auditor-json-read-model-schema",
      source: sourceRef("file", PATHS.auditorSchema),
      condition: "generator_missing: morrowise-auditor.v0 schema exists, but generated public/data/morrowise-auditor.json is not implemented yet.",
      risk_level: "medium",
      suggested_next_action: "Implement auditor fixtures/generator before treating Architecture Pulse as a repeatable scanner.",
      owner: "Codex",
      evidence_refs: [sourceRef("file", PATHS.auditorSchema), sourceRef("file", PATHS.architectureReport)],
      review_after: generatedAt,
    }));
    loops.push(openLoop({
      loop_id: "manual-only-architecture-pulse",
      gate_id: "architecture-pulse",
      source: sourceRef("file", PATHS.architectureReport),
      condition: "manual_only: the current Architecture Pulse drift report is useful evidence, but it is not yet generated from a repeatable scanner.",
      risk_level: "medium",
      suggested_next_action: "Do not patch ARCHITECTURE.md from manual evidence alone; route source edits through a later auditor/source-edit task.",
      owner: "future_agent",
      evidence_refs: [sourceRef("file", PATHS.architectureReport)],
      review_after: generatedAt,
    }));
  } else if ((auditorReport.summary?.finding_count || 0) > 0) {
    loops.push(openLoop({
      loop_id: "auditor-findings-open",
      gate_id: "architecture-pulse",
      source: sourceRef("file", PATHS.auditorReadModel),
      condition: `auditor_findings: the auditor scanner reports ${auditorReport.summary.finding_count} open finding(s) on managed targets.`,
      risk_level: "medium",
      suggested_next_action: `Route fixes through ${auditorReport.summary.primary_next_action}; the auditor stays read-only.`,
      owner: "future_agent",
      evidence_refs: [sourceRef("file", PATHS.auditorReadModel)],
      review_after: generatedAt,
    }));
  }
  loops.push(openLoop({
    loop_id: "second-source-risk-visual-mirrors",
    gate_id: "visual-layer-boundary",
    source: sourceRef("file", PATHS.sourceMapReconcile),
    condition: "second_source_risk: Heptabase, Obsidian Canvas, dashboard surfaces, and chat notes must remain mirrors/evidence, not canonical task state.",
    risk_level: "high",
    suggested_next_action: "Keep visual sync one-way from canonical MC state unless an explicit approved sync task says otherwise.",
    owner: "future_agent",
    evidence_refs: [sourceRef("file", PATHS.sourceMapReconcile), sourceRef("task", PATHS.morrowiseTasks)],
    review_after: generatedAt,
  }));
  loops.push(openLoop({
    loop_id: "stale-generated-read-model-watch",
    gate_id: "prebuild",
    source: sourceRef("generated_data", "$COLLAB/harness-mc/public/data/*.json"),
    condition: "stale: generated read models become stale after task, registry, task-event, worktree, or source-map changes.",
    risk_level: "medium",
    suggested_next_action: "Run npm run prebuild before trusting dashboard or MorroWise system state.",
    owner: "Codex",
    evidence_refs: [sourceRef("generated_data", PATHS.liveDashboard), sourceRef("generated_data", "$COLLAB/harness-mc/public/data/morrowise-system.json")],
    review_after: generatedAt,
  }));

  if (nextTask) {
    loops.push(openLoop({
      loop_id: `task-next-${nextTask.id}`,
      gate_id: "work-anchor-preflight",
      source: sourceRef("task", `${PATHS.morrowiseTasks}#${nextTask.id}`),
      condition: `Next executable MorroWise task is ${nextTask.id}.`,
      risk_level: "medium",
      suggested_next_action: `Run work-anchor preflight, then execute ${nextTask.id}.`,
      owner: "Codex",
      evidence_refs: [sourceRef("task", `${PATHS.morrowiseTasks}#${nextTask.id}`)],
      review_after: generatedAt,
    }));
  }

  if (openTasks.length > 0) {
    loops.push(openLoop({
      loop_id: "morrowise-open-task-backlog",
      gate_id: "task-routing",
      source: sourceRef("task", PATHS.morrowiseTasks),
      condition: `${openTasks.length} MorroWise tasks remain open.`,
      risk_level: "medium",
      suggested_next_action: "Keep next actions anchored in MorroWise tasks before touching docs, surfaces, or runtime adapters.",
      owner: "future_agent",
      evidence_refs: [sourceRef("task", PATHS.morrowiseTasks)],
      review_after: generatedAt,
    }));
  }

  if (pendingEvents > 0) {
    loops.push(openLoop({
      loop_id: "pending-task-events",
      gate_id: "apply_task_events",
      source: sourceRef("generated_data", PATHS.taskEvents),
      condition: `${pendingEvents} task-events are pending reducer application.`,
      risk_level: "medium",
      suggested_next_action: "Run or schedule the single-writer task-event reducer before trusting event-derived task evidence.",
      owner: "Codex",
      evidence_refs: [sourceRef("generated_data", PATHS.taskEvents)],
      review_after: generatedAt,
    }));
  }

  if (staleSurfaces.length > 0) {
    loops.push(openLoop({
      loop_id: "stale-dashboard-surfaces",
      gate_id: "morrowise-live-dashboard",
      source: sourceRef("generated_data", PATHS.liveDashboard),
      condition: `${staleSurfaces.length} MC dashboard surfaces are stale.`,
      risk_level: "medium",
      suggested_next_action: "Regenerate upstream data and live dashboard before treating dashboard surfaces as fresh.",
      owner: "Codex",
      evidence_refs: [sourceRef("generated_data", PATHS.liveDashboard)],
      review_after: generatedAt,
    }));
  }

  if (residualCount > 0) {
    loops.push(openLoop({
      loop_id: "closeout-residuals-present",
      gate_id: "closeout-residual-ledger",
      source: sourceRef("generated_data", PATHS.residualLedger),
      condition: `${residualCount} closeout residuals remain in the ledger.`,
      risk_level: "high",
      suggested_next_action: "Use the residual ledger next anchor before claiming the workspace is clean.",
      owner: "future_agent",
      evidence_refs: [sourceRef("generated_data", PATHS.residualLedger)],
      review_after: generatedAt,
    }));
  }

  const unknownCapabilities = (capabilities?.capabilities || []).filter((capability) => ["unknown", "blocked", "legacy"].includes(capability.status));
  if (unknownCapabilities.length > 0) {
    loops.push(openLoop({
      loop_id: "capability-registry-needs-attention",
      gate_id: "morrowise-wiring-gate",
      source: sourceRef("generated_data", PATHS.capabilities),
      condition: `${unknownCapabilities.length} capabilities are unknown, blocked, or legacy.`,
      risk_level: "medium",
      suggested_next_action: "Finish capability registry follow-up before wiring these routes into live workflows.",
      owner: "Codex",
      evidence_refs: [sourceRef("generated_data", PATHS.capabilities), sourceRef("file", PATHS.capabilityRegistry)],
      review_after: generatedAt,
    }));
  }

  if (!projects) {
    loops.push(openLoop({
      loop_id: "projects-read-model-missing",
      gate_id: "morrowise-system-json-generator-v0",
      source: sourceRef("generated_data", PATHS.projects),
      condition: "projects.json is missing, so project/task current-state summaries are degraded.",
      risk_level: "high",
      suggested_next_action: "Run node scripts/generate-data.mjs before regenerating morrowise-system.json.",
      owner: "Codex",
      evidence_refs: [sourceRef("generated_data", PATHS.projects)],
      review_after: generatedAt,
    }));
  }

  return loops;
}

function selectNextTask(tasks) {
  const done = new Set(tasks.filter((task) => DONE_STATUSES.has(task.status)).map((task) => task.id));
  return tasks.find((task) => {
    if (!ACTIVE_STATUSES.has(task.status || "todo")) return false;
    return (task.dependencies || []).every((dep) => done.has(dep));
  }) || null;
}

function gateFromComponent(component) {
  return {
    gate_id: component.component_id,
    trigger: (component.trigger || []).join("; "),
    source: (component.source_of_truth || []).map((ref) => sourceRef("file", ref)),
    process: (component.process || []).join("; "),
    output: component.output || [],
    surface: component.surface || [],
    close_rule: `admission_state=${component.admission_state}; verifier=${(component.verifier || []).join(", ")}`,
  };
}

function gateFromRegistry(gateId, registryPath, status) {
  return {
    gate_id: gateId,
    trigger: "registry-defined gate",
    source: [sourceRef("file", registryPath)],
    process: status,
    output: ["read-only routing decision"],
    surface: ["MorroWise read model"],
    close_rule: "Must pass its verifier before downstream live claim.",
  };
}

function openLoop(input) {
  return {
    requires_approval: false,
    ...input,
  };
}

function normalizeEvidenceRefs(refs) {
  return refs.map((ref) => {
    if (typeof ref === "string") return sourceRef("file", ref);
    if (ref?.ref) return sourceRef(normalizeSourceType(ref.type), ref.ref);
    return sourceRef("external_ref", JSON.stringify(ref));
  });
}

function sourceRef(type, ref, note) {
  return note ? { type: normalizeSourceType(type), ref, note } : { type: normalizeSourceType(type), ref };
}

function normalizeSourceType(type) {
  if (["file", "task", "event", "commit", "route", "external_ref", "user_request", "generated_data"].includes(type)) return type;
  if (type === "registry" || type === "policy" || type === "runner") return "file";
  return "external_ref";
}

function contextRef(contextId, source, summary) {
  return {
    context_id: contextId,
    source,
    summary,
    evidence_tags: ["morrowise", "system-read-model"],
  };
}

function check(checkId, command, scope, expected) {
  return { check_id: checkId, command, scope, expected };
}

function countBy(items, fn) {
  const counts = {};
  for (const item of items) {
    const key = fn(item);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function normalizeRisk(value) {
  if (["low", "medium", "high"].includes(value)) return value;
  return "medium";
}

function normalizeRunnerOutput(value) {
  if (["summary", "reorder_suggestion", "sync_requested_event_plan", "sync_requested_event", "draft_patch", "approval_request"].includes(value)) return value;
  if (value === "approval") return "approval_request";
  return "summary";
}

function normalizePolicy(value) {
  if (["allowed", "approval_required", "forbidden"].includes(value)) return value;
  return "approval_required";
}

function readJson(repoRoot, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), "utf8"));
}

function readJsonOrNull(repoRoot, relativePath) {
  const file = path.join(repoRoot, relativePath);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  generateMorroWiseSystem();
}
