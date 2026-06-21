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

  const result = {
    project,
    task_source: path.relative(root, taskSource),
    intent: args.intent,
    existing_task_state: existingTaskState,
    active_tasks: activeTasks,
    active_task: activeTasks[0] || null,
    decision: activeTasks.length > 0 ? "allow" : "blocked",
    next_required_step: activeTasks.length > 0
      ? "進入 execution，並把 active_task 作為 work anchor。"
      : "先請 Vincent 確認 proposed task；確認後才可寫入 tasks.json 並開始改檔。",
  };

  if (result.decision === "blocked") {
    result.proposed_task = buildProposedTask(args, project, tasks);
    result.blocked_reason = "No active task found for execution intent.";
  }

  return result;
}

function formatMarkdown(result) {
  const lines = [
    "## Work Anchor Preflight",
    `project: ${result.project}`,
    `task source: ${result.task_source}`,
    `execution intent: ${result.intent}`,
    `existing task state: total=${result.existing_task_state.total}, active=${result.existing_task_state.active}, done=${result.existing_task_state.done}, other=${result.existing_task_state.other}`,
    `active task: ${result.active_task ? `${result.active_task.id} (${result.active_task.status})` : "none"}`,
    `result: ${result.decision}`,
    `next required step: ${result.next_required_step}`,
  ];

  if (result.decision === "blocked") {
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
