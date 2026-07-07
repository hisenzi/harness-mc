import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateTaskEventPipelineData } from "./generate-task-event-data.mjs";
import { processPulseProposals } from "./pulse-proposal-queue.mjs";

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
    "sync:architecture-subsystems",
    "python3",
    [path.join(notyetRoot, "000_Agent", "scripts", "sync-architecture-subsystems.py"), "--check"],
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

// JV-08: 失敗 → proposal 佇列；每輪都跑（healthy 時做 TTL sweep + read model 重生成）
const proposalResult = processPulseProposals({ report, now: finishedAt });
report.proposals = {
  created: proposalResult.created.length,
  escalated: proposalResult.escalated.length,
  pending_decision: proposalResult.readModel.counts.pending_decision,
  oldest_pending_days: proposalResult.readModel.oldest_pending_days,
  read_model: "$COLLAB/harness-mc/public/data/pulse-proposals.json",
};

if (status === "degraded") {
  report.notification = notifyFailure(report, proposalResult);
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
writeLocalHeartbeat(finishedAt);
console.log(`System pulse ${status}: ${report.summary.passed}/${report.summary.total} steps passed`);
console.log(
  `Proposals: +${report.proposals.created} created, ${report.proposals.pending_decision} pending (oldest ${report.proposals.oldest_pending_days}d)`,
);
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

  const repairCommand = repairCommandForStep(firstFailure);
  return {
    type: "fix_failed_step",
    target: firstFailure?.id || "unknown",
    repair_command: repairCommand,
    label: repairCommand
      ? `修復 ${firstFailure.id}：執行 ${repairCommand}，再重跑 npm run test:system-pulse。`
      : "Inspect system-pulse step failure excerpt and fix the owning source, verifier, or generated read model.",
  };
}

function repairCommandForStep(stepResult) {
  if (!stepResult) return null;
  if (stepResult.id === "sync:architecture-subsystems") {
    return 'python3 "$COLLAB/notyet-harness/000_Agent/scripts/sync-architecture-subsystems.py"';
  }
  if (stepResult.id === "sync:architecture-current-state") {
    return 'python3 "$COLLAB/notyet-harness/000_Agent/scripts/sync-architecture-current-state.py"';
  }
  if (stepResult.id === "sync:morrowise-manual") {
    return 'python3 "$COLLAB/notyet-harness/000_Agent/scripts/sync-morrowise-manual.py"';
  }
  return null;
}

// JV-12 heartbeat 契約：每日 pulse 寫本機 heartbeat，隨 git push 跨機可見；
// 對端由 config-sync-state 的 peer_sync_heartbeat 規則監測（>48h → amber 進哨兵早報）
function writeLocalHeartbeat(nowIso) {
  try {
    const heartbeatDir = path.join(notyetRoot, "schedule", "heartbeat");
    fs.mkdirSync(heartbeatDir, { recursive: true });
    const host = os.hostname();
    const head = (repo) => spawnSync("git", ["-C", repo, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).stdout.trim() || null;
    const record = {
      schema_version: "sync-heartbeat.v0",
      host,
      last_run_at: nowIso,
      last_pull_at: null,
      heads: { "notyet-harness": head(notyetRoot), "harness-mc": head(root) },
      written_by: "run-system-pulse",
    };
    fs.writeFileSync(path.join(heartbeatDir, `${host}.json`), `${JSON.stringify(record, null, 2)}\n`);
  } catch (error) {
    console.error(`heartbeat write skipped: ${error.message}`);
  }
}

function notifyFailure(report, proposalResult) {
  const lines = [
    "[MorroWise system-pulse] degraded",
    `failed=${report.summary.failed}/${report.summary.total}`,
    `next=${report.next_action.target || "none"}`,
  ];
  if (report.proposals) {
    lines.push(`proposals: +${report.proposals.created} new, ${report.proposals.pending_decision} pending decision`);
  }
  if (proposalResult?.pushMessage) {
    lines.push(proposalResult.pushMessage);
  }
  lines.push("read $COLLAB/harness-mc/public/data/system-pulse.json");
  const message = lines.join("\n");

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
