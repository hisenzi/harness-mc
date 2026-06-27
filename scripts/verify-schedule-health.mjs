import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateScheduleHealth } from "./generate-schedule-health.mjs";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "schedule-health."));
const schedulerRoot = path.join(tmpRoot, "schedule");
const launchAgentsDir = path.join(tmpRoot, "LaunchAgents");
const outPath = path.join(tmpRoot, "schedule-health.json");

try {
  fs.mkdirSync(path.join(schedulerRoot, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(schedulerRoot, "runs"), { recursive: true });
  fs.mkdirSync(path.join(schedulerRoot, "runners"), { recursive: true });
  fs.mkdirSync(launchAgentsDir, { recursive: true });

  fs.writeFileSync(path.join(schedulerRoot, "dispatch.sh"), "#!/usr/bin/env bash\n");
  fs.writeFileSync(path.join(schedulerRoot, "install.sh"), "#!/usr/bin/env bash\n");
  fs.writeFileSync(path.join(schedulerRoot, "runners", "shell.sh"), "#!/usr/bin/env bash\n");

  fs.writeFileSync(path.join(schedulerRoot, "tasks", "commit-attention-sweep.yaml"), [
    "id: commit-attention-sweep",
    'schedule: "10 22 * * *"',
    "runner: shell",
    "timeout: 120",
    "delivery: configured adapter",
    "task: |",
    "  echo ok",
    "",
  ].join("\n"));

  fs.writeFileSync(path.join(schedulerRoot, "tasks", "missing-runner.yaml"), [
    "id: missing-runner",
    'schedule: "30 8 * * *"',
    "runner: cc",
    "timeout: 60",
    "delivery: none",
    "task: |",
    "  echo missing runner",
    "",
  ].join("\n"));

  fs.writeFileSync(
    path.join(schedulerRoot, "runs", "commit-attention-sweep-20260627T120000Z.log"),
    `${JSON.stringify({
      schema_version: "schedule-run.v0",
      run_id: "commit-attention-sweep-20260627T120000Z",
      task_id: "commit-attention-sweep",
      runner: "shell",
      status: "success",
      exit_code: 0,
      started_at: "2026-06-27T12:00:00Z",
      finished_at: "2026-06-27T12:00:01Z",
      duration_sec: 1,
      timeout_sec: 120,
      timeout_enforced: false,
      log_file: "/tmp/ignored.log",
    })}\ncommit attention ok\n`,
  );

  fs.writeFileSync(
    path.join(launchAgentsDir, "com.hisenzi.schedule.commit-attention-sweep.plist"),
    "<plist></plist>\n",
  );

  const data = generateScheduleHealth({
    schedulerRoot,
    launchAgentsDir,
    outPath,
    generatedAt: "2026-06-27T12:30:00.000Z",
  });

  assert.equal(data.schema_version, "schedule-health.v0");
  assert.equal(data.read_only, true);
  assert.ok(fs.existsSync(outPath), "schedule-health.json should be written");
  assert.ok(data.write_boundary.forbidden.includes("read schedule/.env"));
  assert.ok(data.write_boundary.forbidden.includes("load launchd jobs"));
  assert.equal(data.runtime.dispatch_present, true);
  assert.equal(data.runtime.install_present, true);
  assert.deepEqual(data.runtime.runners, ["shell"]);
  assert.equal(data.summary.tasks_total, 2);
  assert.equal(data.summary.configured_schedules, 2);
  assert.equal(data.summary.installed_plists, 1);
  assert.equal(data.summary.missing_plists, 1);
  assert.equal(data.summary.tasks_missing_runner, 1);
  assert.equal(data.summary.last_run_successes, 1);
  assert.equal(data.summary.tasks_without_run_log, 1);
  assert.equal(data.next_action.type, "task");
  assert.equal(data.next_action.target, "runtime-scheduler-v0");

  const commitAttention = data.tasks.find((task) => task.id === "commit-attention-sweep");
  assert.ok(commitAttention, "commit attention task should be present");
  assert.equal(commitAttention.installed, true);
  assert.equal(commitAttention.runner_present, true);
  assert.equal(commitAttention.last_run.status, "success");
  assert.equal(commitAttention.attention_level, "normal");
  assert.equal(commitAttention.plist_ref, "$HOME/Library/LaunchAgents/com.hisenzi.schedule.commit-attention-sweep.plist");
  assert.equal(commitAttention.spec_ref, "$COLLAB/notyet-harness/schedule/tasks/commit-attention-sweep.yaml");

  const missingRunner = data.tasks.find((task) => task.id === "missing-runner");
  assert.ok(missingRunner, "missing runner task should be present");
  assert.equal(missingRunner.runner_present, false);
  assert.equal(missingRunner.attention_level, "blocked");

  console.log("Schedule health verification OK");
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}
