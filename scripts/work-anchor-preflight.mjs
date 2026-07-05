#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const ACTIVE_STATUSES = new Set(["todo", "in_progress", "doing", "blocked"]);
const DONE_STATUSES = new Set(["done", "completed", "cancelled", "canceled"]);

function parseArgs(argv) {
  const args = {
    project: null,
    tasks: null,
    taskId: null,
    intent: "execution",
    proposedId: null,
    proposedTitle: null,
    proposedTrack: null,
    proposedDoneCondition: null,
    proposedAcceptance: [],
    event: null,
    scope: [],
    contextRefs: [],
    template: null,
    reportFormat: null,
    modelTier: null,
    verifyPlan: null,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--project") args.project = argv[++i];
    else if (arg === "--tasks") args.tasks = argv[++i];
    else if (arg === "--task-id") args.taskId = argv[++i];
    else if (arg === "--intent") args.intent = argv[++i];
    else if (arg === "--proposed-id") args.proposedId = argv[++i];
    else if (arg === "--proposed-title") args.proposedTitle = argv[++i];
    else if (arg === "--proposed-track") args.proposedTrack = argv[++i];
    else if (arg === "--proposed-done-condition") args.proposedDoneCondition = argv[++i];
    else if (arg === "--proposed-acceptance") args.proposedAcceptance.push(argv[++i]);
    else if (arg === "--event") args.event = argv[++i];
    else if (arg === "--scope") args.scope.push(argv[++i]);
    else if (arg === "--context-ref") args.contextRefs.push(argv[++i]);
    else if (arg === "--template") args.template = argv[++i];
    else if (arg === "--report-format") args.reportFormat = argv[++i];
    else if (arg === "--model-tier") args.modelTier = argv[++i];
    else if (arg === "--verify-plan") args.verifyPlan = argv[++i];
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (args.event && !["dispatch", "implementation"].includes(args.event)) {
    throw new Error(`--event must be dispatch or implementation, got: ${args.event}`);
  }

  return args;
}

function usage() {
  return [
    "Usage: node scripts/work-anchor-preflight.mjs --project <id> [options]",
    "",
    "Options:",
    "  --tasks <path>                         Override milestones/<project>/tasks.json",
    "  --task-id <id>                         Use a specific task as the execution anchor",
    "  --intent <text>                        Execution intent label, e.g. 開始 / 可以",
    "  --proposed-id <id>                     Required when no active task exists",
    "  --proposed-title <title>               Required when no active task exists",
    "  --proposed-track <track>               Required when no active task exists",
    "  --proposed-done-condition <text>       Required when no active task exists",
    "  --proposed-acceptance <text>           Repeat for proposed acceptance rows",
    "  --event <dispatch|implementation>      JV-17 事件點 gate：派工前/實作前 checklist（不帶則行為不變）",
    "  --scope <path>                         事件點必填（可重複）：本次可寫範圍（C 契約 §2 邊界 / D3）",
    "  --context-ref <text>                   派工 Context 包補充參照（可重複）",
    "  --template <name>                      派工模板 id（subagent-delegation-templates）",
    "  --report-format <text>                 回報格式（無模板時必填其一）",
    "  --model-tier <tier>                    派工模型分級（C 契約 §3）",
    "  --verify-plan <text>                   驗證路徑（C 契約 §7：實作者不得自我驗證）",
    "  --json                                Output machine-readable JSON",
  ].join("\n");
}

function resolveTaskSource(args) {
  if (args.tasks) return path.resolve(args.tasks);
  if (!args.project) throw new Error("--project is required when --tasks is not provided");
  return path.join(root, "milestones", args.project, "tasks.json");
}

function readTasks(taskSource) {
  const parsed = JSON.parse(fs.readFileSync(taskSource, "utf-8"));
  if (!Array.isArray(parsed.tasks)) {
    throw new Error(`${taskSource} does not contain a tasks array`);
  }
  return parsed.tasks;
}

function normalizeStatus(status) {
  return String(status || "todo").toLowerCase();
}

function summarizeTask(task) {
  return {
    id: task.id,
    title: task.title,
    status: task.status || "todo",
    track: task.track || null,
    done_condition: task.done_condition || null,
    hc_decision: task.hc_decision || null,
  };
}

function buildProposedTask(args, project, tasks) {
  const missing = [];
  if (!args.proposedId) missing.push("--proposed-id");
  if (!args.proposedTitle) missing.push("--proposed-title");
  if (!args.proposedTrack) missing.push("--proposed-track");
  if (!args.proposedDoneCondition) missing.push("--proposed-done-condition");
  if (args.proposedAcceptance.length === 0) missing.push("--proposed-acceptance");

  const fallbackTrack = mostRecentTrack(tasks);

  return {
    complete: missing.length === 0,
    missing,
    task: {
      id: args.proposedId || `${project || "project"}-next-task`,
      title: args.proposedTitle || "待確認的新工作錨點",
      status: "todo",
      track: args.proposedTrack || fallbackTrack || "todo",
      done_condition: args.proposedDoneCondition || "待 Vincent 確認後補上可驗收完成條件。",
      acceptance: args.proposedAcceptance,
    },
  };
}

function mostRecentTrack(tasks) {
  for (const task of [...tasks].reverse()) {
    if (task.track) return task.track;
  }
  return null;
}

export function runPreflight(args) {
  const taskSource = resolveTaskSource(args);
  const tasks = readTasks(taskSource);
  const project = args.project || path.basename(path.dirname(taskSource));
  const existingTaskState = {
    total: tasks.length,
    active: 0,
    done: 0,
    other: 0,
  };

  const activeTasks = [];
  for (const task of tasks) {
    const status = normalizeStatus(task.status);
    if (ACTIVE_STATUSES.has(status)) {
      existingTaskState.active += 1;
      activeTasks.push(summarizeTask(task));
    } else if (DONE_STATUSES.has(status)) {
      existingTaskState.done += 1;
    } else {
      existingTaskState.other += 1;
    }
  }

  const targetTask = args.taskId
    ? activeTasks.find((task) => task.id === args.taskId) || null
    : activeTasks[0] || null;
  const hcGate = targetTask ? evaluateHcGate(targetTask, project) : null;
  const eventGate = args.event ? evaluateEventGate(args, targetTask, hcGate) : null;

  const result = {
    project,
    task_source: path.relative(root, taskSource),
    intent: args.intent,
    target_task_id: args.taskId || null,
    existing_task_state: existingTaskState,
    active_tasks: activeTasks,
    active_task: targetTask,
    hc_gate: hcGate,
    event_gate: eventGate,
    decision:
      targetTask && (!hcGate || hcGate.decision === "allow") && (!eventGate || eventGate.decision === "allow")
        ? "allow"
        : "blocked",
    next_required_step: targetTask
      ? hcGate?.decision === "blocked"
        ? "先輸出 HC decision block；確認 HC 是 thinking check 且 evidence/source-of-truth 清楚後，才可進入 work-anchor / implementation flow。"
        : "進入 execution，並把 active_task 作為 work anchor。"
      : args.taskId
        ? "指定 task 不是 active 狀態；先更新或確認 task 狀態，才可開始改檔。"
        : "先請 Vincent 確認 proposed task；確認後才可寫入 tasks.json 並開始改檔。",
  };

  if (!targetTask && !args.taskId) {
    result.proposed_task = buildProposedTask(args, project, tasks);
    result.blocked_reason = "No active task found for execution intent.";
  } else if (!targetTask && args.taskId) {
    result.blocked_reason = `Target task ${args.taskId} is not active or does not exist.`;
  } else if (hcGate?.decision === "blocked") {
    result.blocked_reason = hcGate.reason;
  } else if (eventGate?.decision === "blocked") {
    result.blocked_reason = eventGate.reason;
    result.next_required_step = eventGate.next_required_step;
  }

  return result;
}

// JV-17 事件點 gate（morrowise/dispatch-gate-extension）。
// 只在 --event 時觸發，不加每 session 啟動負擔。判準不新造，逐條引用：
// - C 契約 §2 派工三件套（Context 包／邊界／回報格式）、§3 分級、§7 實作者不得自我驗證
// - D 矩陣 S/E 類訊號（附上讓派工訊息可帶走，資訊性不擋門）
const HARNESS_REFS = {
  c_contract: "$COLLAB/notyet-harness/000_Agent/docs/morrowise/harness/model-dispatch-contract.md",
  d_matrix: "$COLLAB/notyet-harness/000_Agent/docs/morrowise/harness/judgment-externalization-matrix.md",
  templates: "$COLLAB/notyet-harness/000_Agent/docs/morrowise/harness/subagent-delegation-templates.md",
};

function evaluateEventGate(rawArgs, targetTask, hcGate) {
  const args = { scope: [], contextRefs: [], ...rawArgs };
  const checklist = [];
  const add = (id, ok, requirement, evidence, ref) => checklist.push({ id, ok, requirement, evidence, ref });

  add(
    "anchor_active",
    Boolean(targetTask),
    "有 active work anchor（task id + done_condition）",
    targetTask ? `${targetTask.id}（${targetTask.status}）` : "無 active task",
    `${HARNESS_REFS.d_matrix}#S3`,
  );
  add(
    "hc_gate",
    !hcGate || hcGate.decision === "allow",
    "HC framing gate 通過或不適用",
    hcGate ? hcGate.reason : "n/a",
    "$COLLAB/harness-mc/scripts/work-anchor-preflight.mjs#evaluateHcGate",
  );
  add(
    "write_boundary",
    args.scope.length > 0,
    "宣告本次可寫範圍（≥1 個 --scope）",
    args.scope.length > 0 ? args.scope.join(", ") : "未宣告",
    `${HARNESS_REFS.c_contract}#2-派工三件套（邊界）；${HARNESS_REFS.d_matrix}#D3`,
  );

  if (args.event === "dispatch") {
    add(
      "context_pack",
      Boolean(targetTask?.done_condition) || args.contextRefs.length > 0,
      "Context 包：task anchor 帶 done_condition，或補 --context-ref",
      targetTask?.done_condition ? "anchor done_condition 存在" : args.contextRefs.join(", ") || "缺",
      `${HARNESS_REFS.c_contract}#2-派工三件套（Context 包）`,
    );
    add(
      "report_format",
      Boolean(args.template || args.reportFormat),
      "回報格式：--template（E 模板）或 --report-format 擇一",
      args.template ? `template: ${args.template}` : args.reportFormat || "缺",
      `${HARNESS_REFS.c_contract}#2-派工三件套（回報格式）；${HARNESS_REFS.templates}`,
    );
    add(
      "model_tier",
      Boolean(args.modelTier),
      "宣告派工模型分級（--model-tier）",
      args.modelTier || "缺",
      `${HARNESS_REFS.c_contract}#3-分級表`,
    );
    add(
      "verify_plan",
      Boolean(args.verifyPlan),
      "宣告驗證路徑（--verify-plan）：實作者不得自我驗證",
      args.verifyPlan || "缺",
      `${HARNESS_REFS.c_contract}#7-實作者不得自我驗證`,
    );
  }

  const failing = checklist.filter((item) => !item.ok);
  return {
    event: args.event,
    decision: failing.length === 0 ? "allow" : "blocked",
    reason:
      failing.length === 0
        ? `${args.event} 事件點 checklist 全過`
        : `${args.event} 事件點缺件：${failing.map((item) => item.id).join(", ")}（不給三件套就派工 = 違規）`,
    next_required_step:
      failing.length === 0
        ? null
        : `補齊缺件後重跑 preflight --event ${args.event}；缺件對應規則見 checklist ref 欄。`,
    checklist,
    watch_signals: {
      note: "執行中逐條對照，觸發即停（資訊性附帶，不擋本 gate）",
      stop_signals: `${HARNESS_REFS.d_matrix}#第一類（S1-S5，含 S4 兩輪計數同 C §6）`,
      escalate_signals: `${HARNESS_REFS.d_matrix}#第三類（E1-E5 熔斷提問四件套）`,
    },
  };
}

export function formatMarkdown(result) {
  const lines = [
    "## Work Anchor Preflight",
    `project: ${result.project}`,
    `task source: ${result.task_source}`,
    `execution intent: ${result.intent}`,
    `existing task state: total=${result.existing_task_state.total}, active=${result.existing_task_state.active}, done=${result.existing_task_state.done}, other=${result.existing_task_state.other}`,
    `active task: ${result.active_task ? `${result.active_task.id} (${result.active_task.status})` : "none"}`,
    `hc gate: ${result.hc_gate ? `${result.hc_gate.decision} (${result.hc_gate.reason})` : "n/a"}`,
    `result: ${result.decision}`,
    `next required step: ${result.next_required_step}`,
  ];

  if (result.event_gate) {
    lines.push("", `### 事件點 gate（${result.event_gate.event}）: ${result.event_gate.decision}`);
    for (const item of result.event_gate.checklist) {
      lines.push(`- [${item.ok ? "x" : " "}] ${item.id}: ${item.requirement}｜${item.evidence}`);
    }
    lines.push(`- watch signals: ${result.event_gate.watch_signals.stop_signals}`);
  }

  if (result.decision === "blocked") {
    if (result.blocked_reason) {
      lines.push("", `blocked reason: ${result.blocked_reason}`);
    }
    if (result.hc_gate?.required_fields?.length) {
      lines.push(`required fields: ${result.hc_gate.required_fields.join(", ")}`);
    }
  }

  if (result.decision === "blocked" && result.proposed_task) {
    const proposed = result.proposed_task;
    lines.push("", "proposed task:");
    lines.push(`- id: ${proposed.task.id}`);
    lines.push(`- title: ${proposed.task.title}`);
    lines.push(`- track: ${proposed.task.track}`);
    lines.push(`- done_condition: ${proposed.task.done_condition}`);
    lines.push(`- acceptance: ${proposed.task.acceptance.length ? proposed.task.acceptance.join(" / ") : "missing"}`);
    if (!proposed.complete) {
      lines.push(`- missing proposal fields: ${proposed.missing.join(", ")}`);
    }
  }

  return lines.join("\n");
}

function evaluateHcGate(task, project) {
  if (!requiresHcDecision(task)) {
    return {
      decision: "allow",
      required: false,
      reason: "HC framing not required for this task scope.",
    };
  }

  const decision = task.hc_decision;
  if (!decision || typeof decision !== "object" || Array.isArray(decision)) {
    return {
      decision: "blocked",
      required: true,
      reason: "HC decision block is required before system execution.",
      required_fields: [
        "task_scope",
        "hc_refs",
        "hc_reasoning",
        "hc_confidence or not_required_reason",
        "evidence_refs",
        "source_boundary",
      ],
      proposed_task_scope: `${project}/${task.id}`,
    };
  }

  return {
    decision: "allow",
    required: true,
    reason: "HC decision block present.",
    task_scope: decision.task_scope || `${project}/${task.id}`,
    hc_refs: decision.hc_refs || [],
    not_required_reason: decision.not_required_reason || null,
  };
}

function requiresHcDecision(task) {
  const id = String(task.id || "");
  const track = String(task.track || "");
  const label = String(task.order_label || "");
  return track === "control-plane"
    || track === "morrowise-system"
    || id.startsWith("acp-")
    || id.startsWith("morrowise-")
    || label.startsWith("ACP-")
    || label.startsWith("MC-LIVE-");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const result = runPreflight(args);
  console.log(args.json ? JSON.stringify(result, null, 2) : formatMarkdown(result));
  if (result.decision === "blocked") process.exitCode = 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
