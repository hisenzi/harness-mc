import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const collabRoot = path.resolve(root, "..");
const defaultSchedulerRoot = path.join(collabRoot, "notyet-harness", "schedule");
const defaultOutPath = path.join(root, "public", "data", "schedule-health.json");

export function generateScheduleHealth(options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const schedulerRoot = options.schedulerRoot || defaultSchedulerRoot;
  const launchAgentsDir = options.launchAgentsDir || path.join(os.homedir(), "Library", "LaunchAgents");
  const outPath = options.outPath || defaultOutPath;

  const runtime = runtimeState(schedulerRoot);
  const tasks = readScheduleTasks(schedulerRoot).map((task) => enrichTask(task, schedulerRoot, launchAgentsDir));
  const summary = summarize(tasks, runtime);

  const data = {
    schema_version: "schedule-health.v0",
    generated_at: generatedAt,
    read_only: true,
    source_of_truth: {
      schedule_specs: "$COLLAB/notyet-harness/schedule/tasks/*.yaml",
      runtime_scripts: "$COLLAB/notyet-harness/schedule/{dispatch.sh,install.sh,runners/*.sh}",
      run_logs: "$COLLAB/notyet-harness/schedule/runs/*.log",
      launchd_plists: "$HOME/Library/LaunchAgents/com.hisenzi.schedule.*.plist",
    },
    write_boundary: {
      allowed: ["read scheduler task specs", "read scheduler run headers", "check local plist presence", "write generated health read model"],
      forbidden: ["read schedule/.env", "load launchd jobs", "execute scheduled tasks", "send notifications", "commit", "push"],
    },
    stale_rule: "Regenerate after schedule task edits, dispatch/install changes, scheduler runs, launchd install/load changes, or agent handoff.",
    runtime,
    summary,
    tasks,
    next_action: nextAction(summary, runtime),
  };

  if (options.write !== false) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(data, null, 2)}\n`);
    console.log(
      `Generated ${outPath} — ${summary.tasks_total} tasks, ${summary.installed_plists}/${summary.tasks_total} plists installed, ${summary.last_run_failures} last-run failures`,
    );
  }

  return data;
}

function runtimeState(schedulerRoot) {
  const runnersDir = path.join(schedulerRoot, "runners");
  const runnerFiles = fs.existsSync(runnersDir)
    ? fs.readdirSync(runnersDir).filter((file) => file.endsWith(".sh")).sort()
    : [];

  return {
    scheduler_root_ref: "$COLLAB/notyet-harness/schedule",
    dispatch_present: fs.existsSync(path.join(schedulerRoot, "dispatch.sh")),
    install_present: fs.existsSync(path.join(schedulerRoot, "install.sh")),
    tasks_dir_present: fs.existsSync(path.join(schedulerRoot, "tasks")),
    runs_dir_present: fs.existsSync(path.join(schedulerRoot, "runs")),
    runners: runnerFiles.map((file) => path.basename(file, ".sh")),
  };
}

function readScheduleTasks(schedulerRoot) {
  const tasksDir = path.join(schedulerRoot, "tasks");
  if (!fs.existsSync(tasksDir)) return [];

  return fs.readdirSync(tasksDir)
    .filter((file) => file.endsWith(".yaml"))
    .sort()
    .map((file) => {
      const specPath = path.join(tasksDir, file);
      const text = fs.readFileSync(specPath, "utf8");
      return {
        id: yamlScalar(text, "id") || path.basename(file, ".yaml"),
        schedule: yamlScalar(text, "schedule") || null,
        runner: yamlScalar(text, "runner") || null,
        timeout_sec: numberOrNull(yamlScalar(text, "timeout")),
        delivery: yamlScalar(text, "delivery") || null,
        spec_ref: `$COLLAB/notyet-harness/schedule/tasks/${file}`,
      };
    });
}

function enrichTask(task, schedulerRoot, launchAgentsDir) {
  const label = `com.hisenzi.schedule.${task.id}`;
  const plistPath = path.join(launchAgentsDir, `${label}.plist`);
  const lastRun = readLastRun(task.id, path.join(schedulerRoot, "runs"));
  const runnerPath = task.runner ? path.join(schedulerRoot, "runners", `${task.runner}.sh`) : null;
  const installed = fs.existsSync(plistPath);
  const runnerPresent = runnerPath ? fs.existsSync(runnerPath) : false;

  return {
    ...task,
    plist_label: label,
    plist_ref: `$HOME/Library/LaunchAgents/${label}.plist`,
    installed,
    runner_present: runnerPresent,
    last_run: lastRun,
    attention_level: taskAttention({ installed, runnerPresent, lastRun }),
  };
}

function readLastRun(taskId, runsDir) {
  if (!fs.existsSync(runsDir)) return null;

  const candidates = fs.readdirSync(runsDir)
    .filter((file) => file.endsWith(".log"))
    .map((file) => {
      const fullPath = path.join(runsDir, file);
      const header = readJsonHeader(fullPath);
      if (!header || header.task_id !== taskId) return null;
      return {
        run_id: header.run_id || null,
        status: header.status || "unknown",
        exit_code: Number.isFinite(header.exit_code) ? header.exit_code : null,
        started_at: header.started_at || null,
        finished_at: header.finished_at || null,
        duration_sec: Number.isFinite(header.duration_sec) ? header.duration_sec : null,
        timeout_sec: Number.isFinite(header.timeout_sec) ? header.timeout_sec : null,
        timeout_enforced: typeof header.timeout_enforced === "boolean" ? header.timeout_enforced : null,
        log_ref: `$COLLAB/notyet-harness/schedule/runs/${file}`,
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(b.started_at || "").localeCompare(String(a.started_at || "")));

  return candidates[0] || null;
}

function readJsonHeader(file) {
  try {
    const fd = fs.openSync(file, "r");
    const buffer = Buffer.alloc(8192);
    const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
    fs.closeSync(fd);
    const firstLine = buffer.subarray(0, bytes).toString("utf8").split(/\r?\n/, 1)[0];
    if (!firstLine.startsWith("{")) return null;
    return JSON.parse(firstLine);
  } catch {
    return null;
  }
}

function summarize(tasks, runtime) {
  const runnerCounts = {};
  for (const task of tasks) {
    runnerCounts[task.runner || "missing"] = (runnerCounts[task.runner || "missing"] || 0) + 1;
  }

  return {
    tasks_total: tasks.length,
    configured_schedules: tasks.filter((task) => task.schedule).length,
    installed_plists: tasks.filter((task) => task.installed).length,
    missing_plists: tasks.filter((task) => !task.installed).length,
    runners_available: runtime.runners.length,
    runners_by_type: runnerCounts,
    tasks_missing_runner: tasks.filter((task) => !task.runner_present).length,
    tasks_without_run_log: tasks.filter((task) => !task.last_run).length,
    last_run_successes: tasks.filter((task) => task.last_run?.status === "success").length,
    last_run_failures: tasks.filter((task) => task.last_run && task.last_run.status !== "success").length,
    runtime_ready: Boolean(runtime.dispatch_present && runtime.install_present && runtime.tasks_dir_present && runtime.runners.length > 0),
  };
}

function nextAction(summary, runtime) {
  if (!runtime.dispatch_present || !runtime.install_present) {
    return {
      type: "task",
      target: "runtime-scheduler-v0",
      label: "Finish scheduler runtime scripts before trusting schedule health.",
    };
  }

  if (summary.tasks_missing_runner > 0) {
    return {
      type: "task",
      target: "runtime-scheduler-v0",
      label: "Add or repair missing runner adapters for configured schedule tasks.",
    };
  }

  if (summary.missing_plists > 0) {
    return {
      type: "command",
      target: "$COLLAB/notyet-harness/schedule/install.sh --dry-run",
      label: "Review local launchd plist install plan; loading jobs still requires explicit approval.",
    };
  }

  if (summary.last_run_failures > 0) {
    return {
      type: "task",
      target: "runtime-scheduler-v0",
      label: "Inspect failed scheduler run logs before marking runtime healthy.",
    };
  }

  return {
    type: "none",
    target: null,
    label: "Scheduler runtime health has no generated action from current read model.",
  };
}

function taskAttention({ installed, runnerPresent, lastRun }) {
  if (!runnerPresent) return "blocked";
  if (lastRun && lastRun.status !== "success") return "needs_review";
  if (!installed || !lastRun) return "watch";
  return "normal";
}

function yamlScalar(text, key) {
  const pattern = new RegExp(`^${escapeRegExp(key)}:\\s*(.*)$`, "m");
  const match = text.match(pattern);
  if (!match) return "";
  return match[1]
    .replace(/\s+#.*$/, "")
    .replace(/^["']|["']$/g, "")
    .trim();
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isCli) {
  generateScheduleHealth();
}
