#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateLiveDecision } from "./lib/morrowise-live-decision.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mcRoot = path.resolve(__dirname, "..");

const actionPriorityPath = path.join(mcRoot, "public", "data", "action-priority.json");
const heartbeatPath = path.join(mcRoot, "public", "data", "trusted-heartbeat.json");
const tasksPath = path.join(mcRoot, "milestones", "morrowise", "tasks.json");
const defaultOutPath = path.join(mcRoot, "public", "data", "morrowise-live-decision.json");

const args = process.argv.slice(2);
let outPath = defaultOutPath;
let asOf;
let quiet = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--out" && args[i + 1]) {
    outPath = path.resolve(args[++i]);
  } else if (args[i] === "--as-of" && args[i + 1]) {
    asOf = args[++i];
  } else if (args[i] === "--quiet") {
    quiet = true;
  }
}

const result = evaluateLiveDecision({
  actionPriorityPath,
  heartbeatPath,
  tasksPath,
  ...(asOf ? { asOf } : {}),
  outPath,
  write: true,
});

if (!quiet) {
  console.log(`Generated ${outPath} — status: ${result.overall_status}, focus: ${result.primary_focus?.task_id || "none"}, actions: ${result.recommended_human_actions.length}`);
}
