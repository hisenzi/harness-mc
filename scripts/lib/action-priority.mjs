import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mcRoot = path.resolve(__dirname, "..", "..");
const defaultTasksPath = path.join(mcRoot, "milestones", "morrowise", "tasks.json");
const defaultHeartbeatPath = path.join(mcRoot, "public", "data", "trusted-heartbeat.json");
const defaultOutPath = path.join(mcRoot, "public", "data", "action-priority.json");

export const TERMINAL_CLOSED_SUCCESS_STATUSES = new Set(["done", "completed", "fixed"]);
export const TERMINAL_SUPPRESSED_STATUSES = new Set(["done", "completed", "fixed", "archived", "cancelled"]);

export function evaluateActionPriority(options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const asOf = options.asOf || todayInTaipei();
  const tasksPath = options.tasksPath || defaultTasksPath;
  const heartbeatPath = options.heartbeatPath || defaultHeartbeatPath;

  const rawTasks = options.tasks || readTasksJson(tasksPath);
  const heartbeat = options.heartbeat || readHeartbeatJson(heartbeatPath);

  const taskMap = new Map();
  for (const t of rawTasks) {
    taskMap.set(t.id, t);
  }

  // Count active/todo dependents for priority weighting
  const dependentCounts = new Map();
  for (const t of rawTasks) {
    if (TERMINAL_SUPPRESSED_STATUSES.has(t.status) || t.status === "deferred") continue;
    const deps = Array.isArray(t.dependencies) ? t.dependencies : [];
    for (const depId of deps) {
      dependentCounts.set(depId, (dependentCounts.get(depId) || 0) + 1);
    }
  }

  const eligibleActions = [];
  const blockedActions = [];
  const suppressedActions = [];

  for (const task of rawTasks) {
    // 1. Terminal status suppression (done, completed, fixed, archived, cancelled)
    if (TERMINAL_SUPPRESSED_STATUSES.has(task.status)) {
      suppressedActions.push({
        id: task.id,
        order_label: task.order_label || null,
        title: task.title,
        status: task.status,
        track: task.track || "unspecified",
        reason: `terminal_status_${task.status}`,
        replacement_task_id: task.replacement_task_id || null,
      });
      continue;
    }

    // 2. Deferred status suppression
    if (task.status === "deferred") {
      suppressedActions.push({
        id: task.id,
        order_label: task.order_label || null,
        title: task.title,
        status: task.status,
        track: task.track || "unspecified",
        reason: "deferred_status",
        replacement_task_id: task.replacement_task_id || null,
      });
      continue;
    }

    // 3. Active/Todo candidate: evaluate blockers
    const blockers = [];

    // Check dependencies
    const deps = Array.isArray(task.dependencies) ? task.dependencies : [];
    for (const depId of deps) {
      const depTask = taskMap.get(depId);
      if (!depTask) {
        blockers.push(`missing_dependency_${depId}`);
      } else if (!TERMINAL_CLOSED_SUCCESS_STATUSES.has(depTask.status)) {
        blockers.push(`uncompleted_dependency_${depId}(status:${depTask.status})`);
      }
    }

    // Check execution_contract dependency gates if specified
    const startGates = task.execution_contract?.dependency_gates?.start_requires;
    if (Array.isArray(startGates)) {
      for (const gateId of startGates) {
        const gateTask = taskMap.get(gateId);
        if (!gateTask) {
          blockers.push(`missing_gate_${gateId}`);
        } else if (!TERMINAL_CLOSED_SUCCESS_STATUSES.has(gateTask.status)) {
          blockers.push(`uncompleted_gate_${gateId}(status:${gateTask.status})`);
        }
      }
    }

    // Check weekly core review deadline
    if (task.weekly_core === true && task.review_date && task.review_date < asOf) {
      blockers.push(`weekly_core_review_overdue(date:${task.review_date},as_of:${asOf})`);
    }

    // Check runtime health dependency if applicable (skip blocking in CI headless environment)
    if (task.track === "runtime-delivery" && heartbeat?.overall_status === "blocked") {
      blockers.push("runtime_heartbeat_blocked");
    }

    // Classify candidate
    if (blockers.length > 0) {
      blockedActions.push({
        id: task.id,
        order_label: task.order_label || null,
        title: task.title,
        status: task.status,
        track: task.track || "unspecified",
        priority: task.priority || "medium",
        weekly_core: Boolean(task.weekly_core),
        review_date: task.review_date || null,
        blocked_reasons: blockers,
      });
    } else {
      // Eligible action: compute deterministic priority score
      const { score, reasons } = computePriorityScore(task, dependentCounts.get(task.id) || 0);
      eligibleActions.push({
        id: task.id,
        order_label: task.order_label || null,
        title: task.title,
        status: task.status,
        track: task.track || "unspecified",
        priority: task.priority || "medium",
        weekly_core: Boolean(task.weekly_core),
        review_date: task.review_date || null,
        score,
        reasons,
        done_condition: task.done_condition || null,
      });
    }
  }

  // Deterministic sorting for eligible actions:
  // 1. Highest score first
  // 2. Stable tie-breaker: order_label ascending, then id ascending
  eligibleActions.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const labelA = a.order_label || a.id;
    const labelB = b.order_label || b.id;
    return labelA.localeCompare(labelB);
  });

  // Sort blocked actions by order_label/id for stable output
  blockedActions.sort((a, b) => {
    const labelA = a.order_label || a.id;
    const labelB = b.order_label || b.id;
    return labelA.localeCompare(labelB);
  });

  // Sort suppressed actions for stable output
  suppressedActions.sort((a, b) => a.id.localeCompare(b.id));

  const weeklyCoreTask = rawTasks.find((t) => t.weekly_core && !TERMINAL_SUPPRESSED_STATUSES.has(t.status));
  const focus = eligibleActions[0] || null;

  // Dynamic supersession scanning from canonical task relationships (replaces_task_refs / replacement_task_id)
  const supersessionMap = new Map();
  for (const t of rawTasks) {
    if (Array.isArray(t.replaces_task_refs)) {
      for (const ref of t.replaces_task_refs) {
        const legacyTask = taskMap.get(ref);
        const key = `${ref}::${t.id}`;
        supersessionMap.set(key, {
          legacy_task_id: ref,
          successor_task_id: t.id,
          status: legacyTask ? legacyTask.status : "unknown",
          reason: t.summary || `${ref} superseded by ${t.id}`,
        });
      }
    }
    if (t.replacement_task_id) {
      const key = `${t.id}::${t.replacement_task_id}`;
      supersessionMap.set(key, {
        legacy_task_id: t.id,
        successor_task_id: t.replacement_task_id,
        status: t.status,
        reason: t.summary || `${t.id} replaced by ${t.replacement_task_id}`,
      });
    }
  }

  const supersessions = Array.from(supersessionMap.values()).sort((a, b) => {
    const keyA = `${a.legacy_task_id}::${a.successor_task_id}`;
    const keyB = `${b.legacy_task_id}::${b.successor_task_id}`;
    return keyA.localeCompare(keyB);
  });

  const nextAction = determineNextAction({ focus, blockedActions, weeklyCoreTask, asOf });

  return {
    schema_version: "action-priority.v2",
    generated_at: generatedAt,
    as_of: asOf,
    read_only: true,
    source_of_truth: {
      canonical_tasks: "$COLLAB/harness-mc/milestones/morrowise/tasks.json",
      trusted_heartbeat: "$COLLAB/harness-mc/public/data/trusted-heartbeat.json",
    },
    write_boundary: {
      allowed: [
        "read canonical tasks.json",
        "read trusted heartbeat read model",
        "write generated action priority read model",
      ],
      forbidden: [
        "modify task state",
        "modify tasks.json",
        "select weekly core",
        "change review_date",
        "send notifications",
        "commit",
        "push",
      ],
    },
    summary: {
      total_tasks: rawTasks.length,
      eligible_count: eligibleActions.length,
      blocked_count: blockedActions.length,
      suppressed_count: suppressedActions.length,
      weekly_core_task: weeklyCoreTask ? weeklyCoreTask.id : null,
      top_focus_task: focus ? focus.id : null,
    },
    focus: focus
      ? {
          task_id: focus.id,
          order_label: focus.order_label,
          title: focus.title,
          priority_score: focus.score,
          reasons: focus.reasons,
          next_action: focus.title,
        }
      : null,
    eligible_actions: eligibleActions,
    blocked_actions: blockedActions,
    suppressed_actions: suppressedActions,
    supersessions,
    next_action: nextAction,
  };
}

export function generateActionPriority(options = {}) {
  const outPath = options.outPath || defaultOutPath;
  const data = evaluateActionPriority(options);

  if (options.write !== false) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(data, null, 2)}\n`);
    if (!options.silent) {
      console.log(
        `Generated ${outPath} — eligible: ${data.summary.eligible_count}, blocked: ${data.summary.blocked_count}, suppressed: ${data.summary.suppressed_count}, focus: ${data.summary.top_focus_task || "none"}`
      );
    }
  }

  return data;
}

function computePriorityScore(task, dependentCount) {
  let score = 0;
  const reasons = [];

  // 1. Weekly Core gets highest strategic tier
  if (task.weekly_core) {
    score += 10000;
    reasons.push("weekly_core(+10000)");
  }

  // 2. In-Progress work gets continuation priority
  if (task.status === "in_progress") {
    score += 5000;
    reasons.push("in_progress(+5000)");
  }

  // 3. Priority tier weighting
  const priority = String(task.priority || "medium").toLowerCase();
  if (priority === "critical") {
    score += 3000;
    reasons.push("priority_critical(+3000)");
  } else if (priority === "high") {
    score += 2000;
    reasons.push("priority_high(+2000)");
  } else if (priority === "medium") {
    score += 1000;
    reasons.push("priority_medium(+1000)");
  }

  // 4. Downstream dependent unblocking
  if (dependentCount > 0) {
    const unblockScore = dependentCount * 200;
    score += unblockScore;
    reasons.push(`unblocks_${dependentCount}_tasks(+${unblockScore})`);
  }

  return { score, reasons };
}

function determineNextAction({ focus, blockedActions, weeklyCoreTask, asOf }) {
  if (focus) {
    return {
      type: "task",
      target: focus.id,
      order_label: focus.order_label,
      label: `Execute top priority action: ${focus.title}`,
      score: focus.score,
      reasons: focus.reasons,
    };
  }

  const overdue = blockedActions.find((t) =>
    t.blocked_reasons.some((r) => r.startsWith("weekly_core_review_overdue"))
  );
  if (overdue) {
    return {
      type: "governance",
      target: overdue.id,
      label: `Resolve overdue weekly core review for ${overdue.id} (as_of: ${asOf})`,
    };
  }

  if (blockedActions.length > 0) {
    return {
      type: "unblock",
      target: blockedActions[0].id,
      label: `Inspect blockers for ${blockedActions[0].id}: ${blockedActions[0].blocked_reasons[0]}`,
    };
  }

  return {
    type: "standby",
    target: "none",
    label: "No eligible tasks found. All active tasks completed or suppressed.",
  };
}

function readTasksJson(tasksPath) {
  if (!fs.existsSync(tasksPath)) return [];
  const content = fs.readFileSync(tasksPath, "utf8");
  return JSON.parse(content).tasks || [];
}

function readHeartbeatJson(heartbeatPath) {
  if (!fs.existsSync(heartbeatPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(heartbeatPath, "utf8"));
  } catch {
    return null;
  }
}

function todayInTaipei() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
