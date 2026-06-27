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
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
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

  const result = {
    project,
    task_source: path.relative(root, taskSource),
    intent: args.intent,
    target_task_id: args.taskId || null,
    existing_task_state: existingTaskState,
    active_tasks: activeTasks,
    active_task: targetTask,
    hc_gate: hcGate,
    decision: targetTask && (!hcGate || hcGate.decision === "allow") ? "allow" : "blocked",
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
  }

  return result;
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
