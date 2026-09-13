import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mcRoot = path.resolve(__dirname, "..", "..");
const defaultCollabRoot = path.resolve(mcRoot, "..");
const defaultSchedulerRoot = path.join(defaultCollabRoot, "notyet-harness", "schedule");
const defaultOutPath = path.join(mcRoot, "public", "data", "trusted-heartbeat.json");

export function evaluateHeartbeat(options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const nowMs = options.now ? new Date(options.now).getTime() : Date.now();
  const graceMinutes = Number(options.graceMinutes ?? 120);
  const schedulerRoot = path.resolve(options.schedulerRoot || defaultSchedulerRoot);
  const launchAgentsDir = path.resolve(options.launchAgentsDir || path.join(os.homedir(), "Library", "LaunchAgents"));
  const fixtureOnly = Boolean(options.fixtureOnly);
  // Only an explicit CI environment may skip local scheduler checks. On a workstation a missing
  // or unreadable scheduler root (moved path, macOS TCC denial — existsSync returns false on
  // EACCES) must surface as blocked, never as a skipped check.
  const ciEnvironment = options.ci ?? (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true");

  if (ciEnvironment) {
    const runtime = {
      scheduler_root_ref: "$COLLAB/notyet-harness/schedule",
      dispatch_present: false,
      install_present: false,
      tasks_dir_present: false,
      runs_dir_present: false,
      runners: [],
      environment: "ci_headless",
    };
    const summary = {
      tasks_total: 0,
      declared_count: 0,
      loaded_count: 0,
      missing_plists: 0,
      missing_runners: 0,
      verified_count: 0,
      degraded_count: 0,
      blocked_count: 0,
      fixture_only_count: 0,
      natural_successes_count: 0,
    };
    return {
      schema_version: "trusted-heartbeat.v1",
      generated_at: generatedAt,
      read_only: true,
      source_of_truth: {
        schedule_specs: "$COLLAB/notyet-harness/schedule/tasks/*.yaml",
        runtime_scripts: "$COLLAB/notyet-harness/schedule/{dispatch.sh,install.sh,runners/*.sh}",
        run_logs: "$COLLAB/notyet-harness/schedule/runs/*.log",
        launchd_plists: "$HOME/Library/LaunchAgents/com.hisenzi.schedule.*.plist",
      },
      write_boundary: {
        allowed: [
          "read scheduler task specs",
          "read scheduler run headers",
          "check local plist presence",
          "write generated trusted heartbeat read model",
        ],
        forbidden: [
          "read schedule/.env",
          "load launchd jobs",
          "execute scheduled tasks",
          "send notifications",
          "modify task states",
          "select weekly core",
          "change review_date",
          "extend due tasks",
          "commit",
          "push",
        ],
      },
      stale_rule: "Regenerate after schedule task edits, scheduler runs, launchd install/load changes, or agent handoff.",
      evaluation_mode: "ci_headless",
      overall_status: "ci_headless",
      runtime,
      summary,
      tasks: [],
      next_action: {
        type: "monitor",
        target: "scheduler",
        label: "Headless CI environment detected (no scheduler specs). Runtime heartbeat check skipped.",
      },
    };
  }

  const runtime = evaluateRuntime(schedulerRoot);
  const tasks = readScheduleSpecs(schedulerRoot).map((spec) =>
    evaluateTask({
      spec,
      schedulerRoot,
      launchAgentsDir,
      nowMs,
      graceMinutes,
      fixtureOnly,
    })
  );

  const evaluationMode = fixtureOnly ? "fixture" : "live";
  const summary = summarizeTasks(tasks, evaluationMode);
  const overallStatus = determineOverallStatus(tasks, evaluationMode);
  const nextAction = determineNextAction(tasks, overallStatus, runtime);

  return {
    schema_version: "trusted-heartbeat.v1",
    generated_at: generatedAt,
    read_only: true,
    source_of_truth: {
      schedule_specs: "$COLLAB/notyet-harness/schedule/tasks/*.yaml",
      runtime_scripts: "$COLLAB/notyet-harness/schedule/{dispatch.sh,install.sh,runners/*.sh}",
      run_logs: "$COLLAB/notyet-harness/schedule/runs/*.log",
      launchd_plists: "$HOME/Library/LaunchAgents/com.hisenzi.schedule.*.plist",
    },
    write_boundary: {
      allowed: [
        "read scheduler task specs",
        "read scheduler run headers",
        "check local plist presence",
        "write generated trusted heartbeat read model",
      ],
      forbidden: [
        "read schedule/.env",
        "load launchd jobs",
        "execute scheduled tasks",
        "send notifications",
        "modify task states",
        "select weekly core",
        "change review_date",
        "extend due tasks",
        "commit",
        "push",
      ],
    },
    stale_rule: "Regenerate after schedule task edits, scheduler runs, launchd install/load changes, or agent handoff.",
    evaluation_mode: evaluationMode,
    overall_status: overallStatus,
    runtime,
    summary,
    tasks,
    next_action: nextAction,
  };
}

export function generateTrustedHeartbeat(options = {}) {
  const outPath = options.outPath || defaultOutPath;
  const data = evaluateHeartbeat(options);

  if (options.write !== false) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(data, null, 2)}\n`);
    if (!options.silent) {
      console.log(
        `Generated ${outPath} — status: ${data.overall_status}, tasks: ${data.summary.tasks_total}, verified: ${data.summary.verified_count}, degraded: ${data.summary.degraded_count}, blocked: ${data.summary.blocked_count}`
      );
    }
  }

  return data;
}

function evaluateRuntime(schedulerRoot) {
  const runnersDir = path.join(schedulerRoot, "runners");
  const runnerFiles = fs.existsSync(runnersDir)
    ? fs.readdirSync(runnersDir).filter((f) => f.endsWith(".sh")).sort()
    : [];

  return {
    scheduler_root_ref: "$COLLAB/notyet-harness/schedule",
    dispatch_present: fs.existsSync(path.join(schedulerRoot, "dispatch.sh")),
    install_present: fs.existsSync(path.join(schedulerRoot, "install.sh")),
    tasks_dir_present: fs.existsSync(path.join(schedulerRoot, "tasks")),
    runs_dir_present: fs.existsSync(path.join(schedulerRoot, "runs")),
    runners: runnerFiles.map((f) => path.basename(f, ".sh")),
  };
}

function readScheduleSpecs(schedulerRoot) {
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

function evaluateTask({ spec, schedulerRoot, launchAgentsDir, nowMs, graceMinutes, fixtureOnly }) {
  const label = `com.hisenzi.schedule.${spec.id}`;
  const plistPath = path.join(launchAgentsDir, `${label}.plist`);
  const installed = fs.existsSync(plistPath);

  const runnerPath = spec.runner ? path.join(schedulerRoot, "runners", `${spec.runner}.sh`) : null;
  const runnerPresent = runnerPath ? fs.existsSync(runnerPath) : false;

  const runsDir = path.join(schedulerRoot, "runs");
  const { lastRun, lastSuccess } = readTaskRunHistory(spec.id, runsDir);

  const previousFireMs = calculatePreviousFireAt(spec.schedule, nowMs);
  const previousFireIso = previousFireMs === null ? null : toIso(previousFireMs);
  const lastSuccessIso = lastSuccess?.finished_at || lastSuccess?.started_at || null;
  const lastSuccessMs = lastSuccessIso ? Date.parse(lastSuccessIso) : null;

  // Freshness evaluation
  let freshness;
  if (previousFireMs === null) {
    freshness = "unknown_cadence";
  } else if (!lastSuccessMs || !Number.isFinite(lastSuccessMs)) {
    freshness = "no_success_recorded";
  } else {
    const isPastGrace = nowMs >= previousFireMs + graceMinutes * 60000;
    const threshold = isPastGrace ? previousFireMs : previousFireMs - 86400000;
    freshness = lastSuccessMs >= threshold ? "live" : "stale";
  }

  // Execution analysis
  const isExit126 = lastRun?.exit_code === 126;
  const isTimeout =
    Boolean(lastRun?.timeout_enforced) ||
    lastRun?.status === "timeout" ||
    (spec.timeout_sec && lastRun?.duration_sec && lastRun.duration_sec > spec.timeout_sec && lastRun?.status !== "success");
  const isRunFailed = Boolean(lastRun && (lastRun.status !== "success" || lastRun.exit_code !== 0));

  // Multi-layered status determination:
  // Layer 1: Declared (spec presence)
  // Layer 2: Loaded (plist + runner presence)
  // Layer 3: Runtime execution (exit 126, timeout, failure, or no run)
  // Layer 4: Freshness (live vs stale vs no_success_recorded)
  // Layer 5: Fixture verification barrier (fixture-only cannot claim verified)
  let status;
  let reason = null;
  let attentionLevel = "normal";

  if (!runnerPresent) {
    status = "blocked";
    reason = "missing_runner";
    attentionLevel = "blocked";
  } else if (!installed) {
    status = "blocked";
    reason = "unloaded_plist";
    attentionLevel = "blocked";
  } else if (!lastRun) {
    status = "blocked";
    reason = "no_run_recorded";
    attentionLevel = "blocked";
  } else if (isExit126) {
    status = "blocked";
    reason = "exit_126_permission_denied";
    attentionLevel = "blocked";
  } else if (isTimeout) {
    status = "degraded";
    reason = "timeout_exceeded";
    attentionLevel = "needs_review";
  } else if (isRunFailed) {
    status = "degraded";
    reason = "last_run_failed";
    attentionLevel = "needs_review";
  } else if (freshness === "no_success_recorded") {
    status = "degraded";
    reason = "no_success_recorded";
    attentionLevel = "needs_review";
  } else if (freshness === "stale") {
    status = "degraded";
    reason = "stale_run";
    attentionLevel = "needs_review";
  } else if (fixtureOnly) {
    status = "fixture_only";
    reason = "fixture_only_synthetic_evidence";
    attentionLevel = "needs_review";
  } else {
    status = "verified";
    reason = null;
    attentionLevel = "normal";
  }

  return {
    id: spec.id,
    schedule: spec.schedule,
    runner: spec.runner,
    timeout_sec: spec.timeout_sec,
    delivery: spec.delivery,
    spec_ref: spec.spec_ref,
    plist_label: label,
    plist_ref: `$HOME/Library/LaunchAgents/${label}.plist`,
    declared: true,
    loaded: installed,
    runner_present: runnerPresent,
    last_run: lastRun,
    last_success_at: lastSuccessIso,
    previous_fire_at: previousFireIso,
    freshness,
    status,
    reason,
    attention_level: attentionLevel,
  };
}

function readTaskRunHistory(taskId, runsDir) {
  if (!fs.existsSync(runsDir)) {
    return { lastRun: null, lastSuccess: null };
  }

  const allRuns = fs.readdirSync(runsDir)
    .filter((file) => file.endsWith(".log") && file.startsWith(`${taskId}-`))
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
        timeout_enforced: typeof header.timeout_enforced === "boolean" ? header.timeout_enforced : false,
        log_ref: `$COLLAB/notyet-harness/schedule/runs/${file}`,
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(b.started_at || "").localeCompare(String(a.started_at || "")));

  const lastRun = allRuns[0] || null;
  const lastSuccess = allRuns.find((r) => r.status === "success" && r.exit_code === 0) || null;

  return { lastRun, lastSuccess };
}

export function readJsonHeader(filePath) {
  try {
    const fd = fs.openSync(filePath, "r");
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

export function calculatePreviousFireAt(cron, nowMs) {
  if (!cron) return null;
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minute, hour, dom, month, dow] = parts;

  // Standard daily: "<minute> <hour> * * *" in the machine's local time zone, matching
  // launchd StartCalendarInterval. A fixed zone would misjudge runs on a machine abroad.
  if (dom === "*" && month === "*" && dow === "*") {
    if (!/^\d+$/.test(minute) || !/^\d+$/.test(hour)) return null;
    const fire = new Date(nowMs);
    fire.setHours(Number(hour), Number(minute), 0, 0);
    if (fire.getTime() > nowMs) {
      fire.setDate(fire.getDate() - 1);
    }
    return fire.getTime();
  }

  return null;
}

function summarizeTasks(tasks, evaluationMode) {
  return {
    tasks_total: tasks.length,
    declared_count: tasks.filter((t) => t.declared).length,
    loaded_count: tasks.filter((t) => t.loaded).length,
    missing_plists: tasks.filter((t) => !t.loaded).length,
    missing_runners: tasks.filter((t) => !t.runner_present).length,
    verified_count: tasks.filter((t) => t.status === "verified").length,
    degraded_count: tasks.filter((t) => t.status === "degraded").length,
    blocked_count: tasks.filter((t) => t.status === "blocked").length,
    fixture_only_count: tasks.filter((t) => t.status === "fixture_only").length,
    natural_successes_count: tasks.filter(
      (t) => evaluationMode === "live" && t.status === "verified"
    ).length,
  };
}

function determineOverallStatus(tasks, evaluationMode) {
  if (tasks.length === 0) return "blocked";
  if (tasks.some((t) => t.status === "blocked")) return "blocked";
  if (tasks.some((t) => t.status === "degraded")) return "degraded";
  if (evaluationMode === "fixture" || tasks.some((t) => t.status === "fixture_only")) {
    return "fixture_only";
  }
  if (tasks.every((t) => t.status === "verified")) return "healthy";
  return "degraded";
}

function determineNextAction(tasks, overallStatus, runtime) {
  if (!runtime.tasks_dir_present) {
    return {
      type: "repair",
      target: "scheduler-root",
      label: "Scheduler tasks directory is missing or unreadable on this machine. Check the $COLLAB path and macOS file access (TCC); heartbeat cannot be trusted.",
    };
  }

  if (!runtime.dispatch_present || !runtime.install_present) {
    return {
      type: "task",
      target: "runtime-scheduler-v0",
      label: "Finish scheduler runtime scripts before trusting schedule health.",
    };
  }

  const exit126Task = tasks.find((t) => t.reason === "exit_126_permission_denied");
  if (exit126Task) {
    return {
      type: "repair",
      target: "launchd-entry",
      label: `Launchd permission error (exit 126) in ${exit126Task.id}. Ensure launchd-entry.mjs wrapper is used.`,
    };
  }

  const missingRunnerTask = tasks.find((t) => t.reason === "missing_runner");
  if (missingRunnerTask) {
    return {
      type: "task",
      target: "runtime-scheduler-v0",
      label: `Add missing runner adapter (${missingRunnerTask.runner}.sh) for task ${missingRunnerTask.id}.`,
    };
  }

  const unloadedTask = tasks.find((t) => t.reason === "unloaded_plist");
  if (unloadedTask) {
    return {
      type: "command",
      target: "$COLLAB/notyet-harness/schedule/install.sh --dry-run",
      label: "Review launchd plist install plan; loading jobs requires explicit human approval.",
    };
  }

  const timeoutTask = tasks.find((t) => t.reason === "timeout_exceeded");
  if (timeoutTask) {
    return {
      type: "investigate",
      target: timeoutTask.id,
      label: `Task ${timeoutTask.id} exceeded timeout threshold (${timeoutTask.last_run?.duration_sec}s). Investigate bottleneck.`,
    };
  }

  const failedTask = tasks.find((t) => t.reason === "last_run_failed");
  if (failedTask) {
    return {
      type: "investigate",
      target: failedTask.id,
      label: `Task ${failedTask.id} failed with exit code ${failedTask.last_run?.exit_code}. Inspect run log: ${failedTask.last_run?.log_ref}`,
    };
  }

  const staleTask = tasks.find((t) => t.reason === "stale_run" || t.reason === "no_success_recorded");
  if (staleTask) {
    return {
      type: "dispatch",
      target: staleTask.id,
      label: `Task ${staleTask.id} has ${staleTask.reason}. Check launchctl status or execute schedule dispatch.`,
    };
  }

  if (overallStatus === "fixture_only") {
    return {
      type: "monitor",
      target: "scheduler",
      label: "Fixture verification only. Natural schedule trigger evidence required for verified live status.",
    };
  }

  return {
    type: "monitor",
    target: "scheduler",
    label: "All scheduled tasks verified healthy with live runtime evidence.",
  };
}

function yamlScalar(text, key) {
  const match = new RegExp(`^${key}:\\s*(?:["']?([^"'#\n]+)["']?)?\\s*(?:#.*)?$`, "m").exec(text);
  return match ? match[1]?.trim() : null;
}

function numberOrNull(val) {
  if (val === null || val === undefined) return null;
  const num = Number(val);
  return Number.isFinite(num) ? num : null;
}

function toIso(ms) {
  return new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");
}
