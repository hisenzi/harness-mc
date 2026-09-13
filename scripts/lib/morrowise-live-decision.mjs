import fs from "node:fs";
import path from "node:path";

/**
 * @typedef {Object} LiveDecisionOptions
 * @property {Object} [actionPriority]
 * @property {string} [actionPriorityPath]
 * @property {Object} [heartbeat]
 * @property {string} [heartbeatPath]
 * @property {Array} [tasks]
 * @property {string} [tasksPath]
 * @property {string} [asOf]
 * @property {string} [generatedAt]
 * @property {string} [outPath]
 * @property {boolean} [write=false]
 */

/**
 * Evaluate MorroWise Live Daily Decision
 * @param {LiveDecisionOptions} options
 */
export function evaluateLiveDecision(options = {}) {
  const asOf = options.asOf || todayInTaipei();
  const generatedAt = options.generatedAt || new Date().toISOString();

  // 1. Load Action Priority
  let actionPriority = options.actionPriority;
  if (!actionPriority && options.actionPriorityPath && fs.existsSync(options.actionPriorityPath)) {
    try {
      actionPriority = JSON.parse(fs.readFileSync(options.actionPriorityPath, "utf8"));
    } catch {
      actionPriority = null;
    }
  }

  // 2. Load Trusted Heartbeat
  let heartbeat = options.heartbeat;
  if (!heartbeat && options.heartbeatPath && fs.existsSync(options.heartbeatPath)) {
    try {
      heartbeat = JSON.parse(fs.readFileSync(options.heartbeatPath, "utf8"));
    } catch {
      heartbeat = null;
    }
  }

  // 3. Load Canonical Tasks (for reality tax lineage and cross-checking)
  let tasks = options.tasks;
  if (!tasks && options.tasksPath && fs.existsSync(options.tasksPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(options.tasksPath, "utf8"));
      tasks = Array.isArray(data) ? data : data.tasks || [];
    } catch {
      tasks = [];
    }
  }
  tasks = tasks || [];

  const issues = [];
  let overallStatus = "verified";

  // Validate action priority input
  if (!actionPriority || actionPriority.schema_version !== "action-priority.v2") {
    overallStatus = "blocked";
    issues.push("missing_or_invalid_action_priority_input");
  }

  // Validate trusted heartbeat input
  if (!heartbeat || heartbeat.schema_version !== "trusted-heartbeat.v1") {
    overallStatus = "blocked";
    issues.push("missing_or_invalid_trusted_heartbeat_input");
  }

  // If inputs are blocked, return degraded/blocked decision structure immediately
  if (overallStatus === "blocked") {
    return buildDecisionOutput({
      overallStatus: "blocked",
      asOf,
      generatedAt,
      issues,
      primaryFocus: null,
      nextAction: {
        target: "system-inputs",
        label: `Resolve decision blockers: ${issues.join(", ")}`,
        type: "system_blocker",
      },
      heartbeatStatus: {
        status: heartbeat?.overall_status || "unknown",
        verified_tasks: heartbeat?.verified_tasks || [],
        degraded_tasks: heartbeat?.degraded_tasks || [],
        blocked_tasks: heartbeat?.blocked_tasks || [],
        attention_required: true,
      },
      realityTax: {
        status: "unknown",
        replacement_lineage: getRealityTaxLineage(tasks),
        attention_items: [],
      },
      taskPoolSummary: {
        eligible_count: actionPriority?.summary?.eligible_count || 0,
        blocked_count: actionPriority?.summary?.blocked_count || 0,
        suppressed_count: actionPriority?.summary?.suppressed_count || 0,
        top_focus_task: null,
      },
      recommendedActions: [
        {
          priority: 1,
          type: "input_blocker",
          action: `Fix upstream inputs: ${issues.join(", ")}`,
        },
      ],
      briefMessage: `[MorroWise 每日決策] ⚠️ 決策受阻：${issues.join(", ")}`,
      outPath: options.outPath,
      write: options.write,
    });
  }

  // Process Heartbeat Assessment
  const hbTasks = Array.isArray(heartbeat.tasks) ? heartbeat.tasks : [];
  const degradedTasks = hbTasks.filter((t) => t.status === "degraded");
  const blockedTasks = hbTasks.filter((t) => t.status === "blocked");
  const verifiedTasks = hbTasks.filter((t) => t.status === "verified");

  const isHbHealthy = heartbeat.overall_status === "healthy" || heartbeat.overall_status === "verified";
  const isHbCi = heartbeat.overall_status === "ci_headless";
  const hbAttentionRequired = heartbeat.overall_status === "blocked" || heartbeat.overall_status === "degraded";

  if (heartbeat.overall_status === "blocked") {
    overallStatus = "blocked";
  } else if (heartbeat.overall_status === "degraded" && overallStatus === "verified") {
    overallStatus = "degraded";
  }

  // Process Reality Tax Lineage & 30-min/24-hr check
  const realityTax = evaluateRealityTax(tasks, options.realityTaxRecords);
  if (realityTax.status === "attention_needed" && overallStatus === "verified") {
    overallStatus = "degraded";
  }

  // Determine Primary Focus & Recommended Human Actions
  const recommendedActions = [];
  let primaryFocus = null;
  let nextAction = null;

  // 1. Heartbeat degraded/blocked alert action (Priority 1)
  if (hbAttentionRequired) {
    for (const dt of [...blockedTasks, ...degradedTasks]) {
      const exitInfo = dt.last_run?.exit_code !== null && dt.last_run?.exit_code !== undefined ? ` (exit ${dt.last_run.exit_code})` : "";
      const reasonInfo = dt.reason ? `: ${dt.reason}` : "";
      recommendedActions.push({
        priority: 1,
        type: dt.status === "blocked" ? "heartbeat_blocked" : "heartbeat_degraded",
        target: dt.id,
        action: `Repair scheduler task ${dt.id}${exitInfo}${reasonInfo}. Log: ${dt.last_run?.log_ref || "none"}`,
      });
    }
  }

  // 2. Reality Tax attention actions (Priority 2)
  if (realityTax.attention_items.length > 0) {
    for (const item of realityTax.attention_items) {
      recommendedActions.push({
        priority: 2,
        type: "reality_tax_attention",
        target: item.task_id,
        action: item.reason,
      });
    }
  }

  // 3. Action Priority Focus (Priority 3 or Priority 1 if no system alerts)
  if (actionPriority.focus && actionPriority.focus.task_id) {
    const focusItem = actionPriority.eligible_actions?.find((t) => t.id === actionPriority.focus.task_id) || {};
    primaryFocus = {
      task_id: actionPriority.focus.task_id,
      order_label: actionPriority.focus.order_label || focusItem.order_label || null,
      title: actionPriority.focus.title || focusItem.title || actionPriority.focus.task_id,
      score: actionPriority.focus.priority_score ?? actionPriority.focus.score ?? focusItem.score ?? 0,
      reasons: actionPriority.focus.reasons || focusItem.reasons || [],
      done_condition: focusItem.done_condition || "",
    };

    const nextActionLabel = actionPriority.next_action?.label || `Execute ${primaryFocus.order_label || primaryFocus.task_id}: ${primaryFocus.title}`;
    nextAction = {
      target: primaryFocus.task_id,
      label: nextActionLabel,
      type: "task_execution",
    };

    recommendedActions.push({
      priority: recommendedActions.length === 0 ? 1 : 3,
      type: "primary_focus",
      target: primaryFocus.task_id,
      action: nextActionLabel,
    });
  } else {
    nextAction = {
      target: null,
      label: "No eligible action available; inspect blocked tasks",
      type: "triage",
    };
  }

  // Generate Brief Message for Telegram / Dashboard Notification
  const focusTitle = primaryFocus ? `[${primaryFocus.order_label || primaryFocus.task_id}] ${primaryFocus.title}` : "無可執行焦點任務";
  const hbIssues = [...blockedTasks, ...degradedTasks].map((t) => t.id).join(", ");
  const hbSummary = isHbHealthy
    ? "正常"
    : isHbCi
    ? "CI 環境 (跳過本機檢查)"
    : `${heartbeat.overall_status}${hbIssues ? ` (${hbIssues})` : ""}`;
  const pool = actionPriority.summary;

  const briefMessage = [
    `[MorroWise 每日決策] ${asOf}`,
    `🎯 焦點任務：${focusTitle}`,
    `⚡ 系統心跳：${hbSummary}`,
    `📊 任務池：${pool.eligible_count} 可執行 · ${pool.blocked_count} 阻塞 · ${pool.suppressed_count} 已收斂`,
    `💡 下一步：${nextAction.label}`,
  ].join("\n");

  return buildDecisionOutput({
    overallStatus,
    asOf,
    generatedAt,
    issues,
    primaryFocus,
    nextAction,
    heartbeatStatus: {
      status: heartbeat.overall_status,
      freshness: hbTasks.find((t) => t.freshness)?.freshness || "unknown",
      tasks_total: hbTasks.length,
      verified_tasks: verifiedTasks.map((t) => t.id),
      degraded_tasks: degradedTasks.map((t) => ({ id: t.id, reason: t.reason, exit_code: t.last_run?.exit_code })),
      blocked_tasks: blockedTasks.map((t) => ({ id: t.id, reason: t.reason })),
      attention_required: hbAttentionRequired,
    },
    realityTax,
    taskPoolSummary: {
      eligible_count: pool.eligible_count,
      blocked_count: pool.blocked_count,
      suppressed_count: pool.suppressed_count,
      top_focus_task: pool.top_focus_task,
    },
    recommendedActions,
    briefMessage,
    outPath: options.outPath,
    write: options.write,
  });
}

function evaluateRealityTax(tasks, records) {
  const lineage = getRealityTaxLineage(tasks);
  const attentionItems = [];

  // Reality Tax Gate ($COLLAB/notyet-harness/000_Agent/docs/morrowise/reality-tax-gate-protocol.md):
  // the 30-minute trigger happens inside agent conversations and routes are recorded in task
  // notes, decision logs or task proposals. tasks.json carries no machine-readable gate record,
  // so the check is evaluable only when gate records are supplied; otherwise report
  // not_evaluable instead of a fake "cleared".
  if (!Array.isArray(records)) {
    return {
      status: "not_evaluable",
      trigger_rule: "concept_discussion_over_30m_without_24h_output",
      reason: "no machine-readable Reality Tax gate record source",
      replacement_lineage: lineage,
      attention_items: attentionItems,
    };
  }

  for (const record of records) {
    const anchored = Boolean(record.task_anchor) || (Array.isArray(record.evidence_refs) && record.evidence_refs.length > 0);
    if (record.route === "mark_reality_gap" || !anchored) {
      attentionItems.push({
        task_id: record.task_anchor || null,
        route: record.route || null,
        reason: record.route === "mark_reality_gap"
          ? "Reality Tax gate marked reality_gap: attach a 24h output, create a task anchor, or kill the loop."
          : `Reality Tax gate route ${record.route || "unknown"} has no task anchor or evidence.`,
      });
    }
  }

  return {
    status: attentionItems.length > 0 ? "attention_needed" : "cleared",
    trigger_rule: "concept_discussion_over_30m_without_24h_output",
    replacement_lineage: lineage,
    attention_items: attentionItems,
  };
}

function getRealityTaxLineage(tasks) {
  const legacyTask = tasks.find((t) => t.id === "reality-tax-daily-review-task");
  const successorTask = tasks.find((t) =>
    t.replaces_task_refs?.includes("reality-tax-daily-review-task") ||
    t.id === legacyTask?.replacement_task_id
  );
  return {
    legacy_task_id: "reality-tax-daily-review-task",
    successor_task_id: successorTask ? successorTask.id : (legacyTask?.replacement_task_id || "morrowise-live-decision-loop-v1"),
    legacy_status: legacyTask?.status || "cancelled",
    reciprocal_linkage: Boolean(legacyTask && successorTask),
    rule: "Reality Tax 30-min/24-hr outcome check is unified into live decision; parallel daily loop forbidden.",
  };
}

function buildDecisionOutput({
  overallStatus,
  asOf,
  generatedAt,
  issues,
  primaryFocus,
  nextAction,
  heartbeatStatus,
  realityTax,
  taskPoolSummary,
  recommendedActions,
  briefMessage,
  outPath,
  write,
}) {
  const output = {
    schema_version: "morrowise-live-decision.v1",
    generated_at: generatedAt,
    as_of: asOf,
    read_only: true,
    write_boundary: {
      allowed: ["public/data/morrowise-live-decision.json"],
      forbidden: [
        "modify task state",
        "modify tasks.json",
        "execute unscheduled scripts",
        "send unauthorized external delivery",
        "automatically commit or push",
      ],
    },
    overall_status: overallStatus,
    issues: issues.length > 0 ? issues : [],
    primary_focus: primaryFocus,
    next_action: nextAction,
    heartbeat_status: heartbeatStatus,
    reality_tax: realityTax,
    task_pool_summary: taskPoolSummary,
    recommended_human_actions: recommendedActions,
    brief_message: briefMessage,
    sources: [
      "public/data/action-priority.json",
      "public/data/trusted-heartbeat.json",
      "milestones/morrowise/tasks.json",
    ],
  };

  if (write && outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  }

  return output;
}

function todayInTaipei() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
