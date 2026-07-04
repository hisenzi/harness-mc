import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateTaskEventPipelineData } from "./generate-task-event-data.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const collabRoot = path.resolve(root, "..");
const notyetRoot = path.join(collabRoot, "notyet-harness");
const outPath = path.join(root, "public", "data", "system-pulse.json");
const notifyPath = path.join(notyetRoot, "schedule", "lib", "notify.sh");

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const applyTaskEvents = process.env.SYSTEM_PULSE_APPLY_TASK_EVENTS === "1";
const allowPending = process.env.SYSTEM_PULSE_ALLOW_PENDING === "1";

const npmTestScripts = readNpmTestScripts();
const plan = [
  step("prebuild", "npm", ["run", "prebuild"], root),
  ...npmTestScripts.map((name) => step(`npm:${name}`, "npm", ["run", name], root)),
  step(
    "sync:morrowise-manual",
    "python3",
    [path.join(notyetRoot, "000_Agent", "scripts", "sync-morrowise-manual.py"), "--check"],
    collabRoot,
  ),
  step(
    "sync:architecture-current-state",
    "python3",
    [path.join(notyetRoot, "000_Agent", "scripts", "sync-architecture-current-state.py"), "--check"],
    collabRoot,
  ),
  step(
    applyTaskEvents ? "task-events:apply" : "task-events:report",
    "node",
    [applyTaskEvents ? "scripts/apply-task-events.mjs" : "scripts/generate-task-event-data.mjs"],
    root,
  ),
];

if (dryRun) {
  for (const item of plan) {
    console.log(`${item.id}\t${displayCommand(item)}`);
  }
  console.log(`task_events_mode=${applyTaskEvents ? "apply" : "report"}`);
  process.exit(0);
}

const startedAt = new Date().toISOString();
const results = [];
let failed = false;

for (const item of plan) {
  const result = runStep(item);
  results.push(result);
  if (result.status !== "pass") failed = true;
}

const taskEventState = readTaskEventState();
if (!applyTaskEvents && !allowPending && taskEventState.task_events.pending > 0) {
  failed = true;
  results.push({
    id: "task-events:pending-gate",
    command: "read public/data/task-events.json",
    cwd_ref: "$COLLAB/harness-mc",
    status: "fail",
    exit_code: 1,
    duration_ms: 0,
    stdout_excerpt: "",
    stderr_excerpt: `${taskEventState.task_events.pending} pending task event(s); default mode is report-only. Set SYSTEM_PULSE_APPLY_TASK_EVENTS=1 only after Vincent approves daily reducer apply.`,
  });
}

const finishedAt = new Date().toISOString();
const status = failed ? "degraded" : "healthy";
const report = {
  schema_version: "system-pulse.v0",
  generated_at: finishedAt,
  started_at: startedAt,
  finished_at: finishedAt,
  status,
  read_only_by_default: true,
  task_events_mode: applyTaskEvents ? "apply" : "report",
  write_boundary: {
    allowed: [
      "run local generators and verifiers",
      "write generated system-pulse read model",
      "write task-event read model",
      "apply task events only when SYSTEM_PULSE_APPLY_TASK_EVENTS=1",
      "send failure notification through schedule notification adapter",
    ],
    forbidden: [
      "read schedule/.env directly",
      "print tokens or credentials",
      "commit",
      "push",
      "load launchd jobs",
    ],
  },
  task_event_state: taskEventState,
  summary: summarize(results),
  steps: results,
  next_action: nextAction(status, results, taskEventState),
  notification: null,
};

if (status === "degraded") {
  report.notification = notifyFailure(report);
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`System pulse ${status}: ${report.summary.passed}/${report.summary.total} steps passed`);
if (report.notification) {
  console.log(`Notification: ${report.notification.status}`);
}

process.exit(status === "healthy" ? 0 : 1);

function step(id, command, stepArgs, cwd) {
  return { id, command, args: stepArgs, cwd };
}

function readNpmTestScripts() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  return Object.keys(packageJson.scripts || {})
    .filter((name) => name.startsWith("test:"))
    .sort((a, b) => a.localeCompare(b));
}

function runStep(item) {
  const started = Date.now();
  const result = spawnSync(item.command, item.args, {
    cwd: item.cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_loglevel: "silent",
    },
  });
  const exitCode = result.status ?? (result.error ? 1 : 0);
  const status = exitCode === 0 ? "pass" : "fail";
  return {
    id: item.id,
    command: displayCommand(item),
    cwd_ref: refPath(item.cwd),
    status,
    exit_code: exitCode,
    duration_ms: Date.now() - started,
    stdout_excerpt: excerpt(result.stdout || ""),
    stderr_excerpt: excerpt(result.error?.message || result.stderr || ""),
  };
}

function displayCommand(item) {
  return sanitize(`${item.command} ${item.args.join(" ")}`);
}

function readTaskEventState() {
  try {
    const data = generateTaskEventPipelineData({ root, write: false });
    return {
      task_events: data.task_events,
      sync_events: data.sync_events,
      latest_reducer_run: data.latest_reducer_run,
    };
  } catch (error) {
    return {
      task_events: { pending: -1, applied: -1, rejected: -1, rejected_by_reason: {} },
      sync_events: { pending: -1, synced: -1, failed: -1, by_target: {} },
      latest_reducer_run: null,
      error: sanitize(String(error?.message || error)),
    };
  }
}

function summarize(items) {
  const failedItems = items.filter((item) => item.status !== "pass");
  return {
    total: items.length,
    passed: items.length - failedItems.length,
    failed: failedItems.length,
    duration_ms: items.reduce((sum, item) => sum + item.duration_ms, 0),
  };
}

function nextAction(status, items, taskEventState) {
  if (status !== "degraded") {
    return {
      type: "none",
      target: null,
      label: "System pulse is healthy; no generated action.",
    };
  }

  const firstFailure = items.find((item) => item.status !== "pass");
  if (firstFailure?.id === "task-events:pending-gate") {
    return {
      type: "task",
      target: "task-event-reducer-apply-decision",
      label: `There are ${taskEventState.task_events.pending} pending task event(s). Vincent should decide whether system-pulse may run reducer apply mode.`,
    };
  }

  return {
    type: "fix_failed_step",
    target: firstFailure?.id || "unknown",
    label: "Inspect system-pulse step failure excerpt and fix the owning source, verifier, or generated read model.",
  };
}

function notifyFailure(report) {
  const message = [
    "[MorroWise system-pulse] degraded",
    `failed=${report.summary.failed}/${report.summary.total}`,
    `next=${report.next_action.target || "none"}`,
    "read $COLLAB/harness-mc/public/data/system-pulse.json",
  ].join("\n");

  if (!fs.existsSync(notifyPath)) {
    return { status: "skipped", reason: "notify.sh missing" };
  }

  const result = spawnSync("bash", [notifyPath, message], {
    cwd: collabRoot,
    encoding: "utf8",
  });
  const exitCode = result.status ?? (result.error ? 1 : 0);
  if (exitCode === 0) {
    return { status: "sent", exit_code: exitCode, stdout_excerpt: excerpt(result.stdout || "") };
  }
  if (exitCode === 2) {
    return {
      status: "skipped_missing_env",
      exit_code: exitCode,
      stderr_excerpt: excerpt(result.stderr || result.stdout || ""),
    };
  }
  return {
    status: "failed",
    exit_code: exitCode,
    stderr_excerpt: excerpt(result.error?.message || result.stderr || result.stdout || ""),
  };
}

function refPath(value) {
  return value
    .replace(root, "$COLLAB/harness-mc")
    .replace(notyetRoot, "$COLLAB/notyet-harness")
    .replace(collabRoot, "$COLLAB");
}

function excerpt(value) {
  return sanitize(value)
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-20)
    .join("\n")
    .slice(0, 4000);
}

function sanitize(value) {
  const home = process.env.HOME || "";
  return String(value)
    .replaceAll(root, "$COLLAB/harness-mc")
    .replaceAll(notyetRoot, "$COLLAB/notyet-harness")
    .replaceAll(collabRoot, "$COLLAB")
    .replace(home ? new RegExp(escapeRegExp(home), "g") : /$^/, "$HOME");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
