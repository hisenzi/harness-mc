import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyTaskEvents } from "./apply-task-events.mjs";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "apply-task-events-"));

const projectDir = path.join(tmpRoot, "milestones", "demo-project");
const pendingDir = path.join(tmpRoot, "task-events", "pending");
fs.mkdirSync(projectDir, { recursive: true });
fs.mkdirSync(pendingDir, { recursive: true });

writeJson(path.join(projectDir, "tasks.json"), {
  tasks: [
    {
      id: "task-1",
      title: "First task",
      status: "in_progress",
      commits: ["old1111"],
      external_refs: {
        heptabase: {
          whiteboard: "MC 儀表版",
          card_id: "card-task-1",
        },
      },
    },
    {
      id: "task-2",
      title: "Second task",
      status: "completed",
      completed_at: "2026-06-01",
      commits: [],
    },
    {
      id: "task-3",
      title: "Third task",
      status: "todo",
    },
  ],
});

writeEvent("001-complete.json", {
  event_id: "evt-complete-task-1",
  type: "task.completed",
  repo: "demo-repo",
  commit: "abc1234",
  project: "demo-project",
  task_id: "task-1",
  summary: "Task 1 completed.",
  created_at: "2026-06-15T09:00:00+08:00",
  actor: "codex",
  session_id: "session-1",
});

writeEvent("002-duplicate.json", {
  event_id: "evt-complete-task-1",
  type: "task.completed",
  repo: "demo-repo",
  commit: "abc1234",
  project: "demo-project",
  task_id: "task-1",
  summary: "Duplicate event should not apply twice.",
  created_at: "2026-06-15T09:01:00+08:00",
  actor: "codex",
  session_id: "session-1",
});

writeEvent("003-reopen.json", {
  event_id: "evt-reopen-task-2",
  type: "task.reopened",
  repo: "demo-repo",
  commit: "def5678",
  project: "demo-project",
  task_id: "task-2",
  summary: "Task 2 reopened.",
  created_at: "2026-06-15T10:00:00+08:00",
  actor: "codex",
  session_id: "session-2",
});

writeEvent("004-blocked.json", {
  event_id: "evt-block-task-3",
  type: "task.blocked",
  repo: "demo-repo",
  commit: "fed4321",
  project: "demo-project",
  task_id: "task-3",
  summary: "Task 3 blocked.",
  created_at: "2026-06-15T11:00:00+08:00",
  actor: "codex",
  session_id: "session-3",
});

writeEvent("005-commit-attached.json", {
  event_id: "evt-attach-task-3",
  type: "task.commit_attached",
  repo: "demo-repo",
  commit: "bee9999",
  project: "demo-project",
  task_id: "task-3",
  summary: "Attach commit without status change.",
  created_at: "2026-06-15T11:30:00+08:00",
  actor: "codex",
  session_id: "session-3",
});

writeEvent("006-unknown-task.json", {
  event_id: "evt-unknown-task",
  type: "task.completed",
  repo: "demo-repo",
  commit: "bad0001",
  project: "demo-project",
  task_id: "missing-task",
  summary: "Unknown task should reject.",
  created_at: "2026-06-15T12:00:00+08:00",
  actor: "codex",
  session_id: "session-4",
});

writeEvent("007-unknown-type.json", {
  event_id: "evt-unknown-type",
  type: "task.archived",
  repo: "demo-repo",
  commit: "bad0002",
  project: "demo-project",
  task_id: "task-1",
  summary: "Unknown type should reject.",
  created_at: "2026-06-15T12:30:00+08:00",
  actor: "codex",
  session_id: "session-5",
});

writeEvent("008-unknown-project.json", {
  event_id: "evt-unknown-project",
  type: "task.completed",
  repo: "demo-repo",
  commit: "bad0003",
  project: "missing-project",
  task_id: "task-1",
  summary: "Unknown project should reject without crashing.",
  created_at: "2026-06-15T13:00:00+08:00",
  actor: "codex",
  session_id: "session-6",
});

const report = applyTaskEvents({ root: tmpRoot, runGenerateData: false });

assert.equal(report.applied.length, 4);
assert.equal(report.rejected.length, 4);
assert.equal(report.duplicates.length, 1);
assert.equal(report.rejected.find((item) => item.event_id === "evt-unknown-task").reason, "unknown_task");
assert.equal(report.rejected.find((item) => item.event_id === "evt-unknown-type").reason, "unknown_type");
assert.equal(report.rejected.find((item) => item.event_id === "evt-unknown-project").reason, "unknown_task");

const definitionsAfterApply = JSON.parse(fs.readFileSync(path.join(projectDir, "tasks.json"), "utf8"));
assert.equal(definitionsAfterApply.tasks.find((task) => task.id === "task-1").status, "in_progress");
assert.equal(definitionsAfterApply.tasks.find((task) => task.id === "task-2").status, "completed");
assert.equal(definitionsAfterApply.tasks.find((task) => task.id === "task-3").status, "todo");

const state = JSON.parse(fs.readFileSync(path.join(projectDir, "state.json"), "utf8"));
const task1 = state.tasks["task-1"];
const task2 = state.tasks["task-2"];
const task3 = state.tasks["task-3"];

assert.equal(task1.status, "completed");
assert.equal(task1.completed_at, "2026-06-15");
assert.deepEqual(task1.commits, ["old1111", "abc1234"]);

assert.equal(task2.status, "in_progress");
assert.equal(task2.completed_at, undefined);
assert.deepEqual(task2.commits, ["def5678"]);

assert.equal(task3.status, "blocked");
assert.deepEqual(task3.commits, ["fed4321", "bee9999"]);

assert.deepEqual(fs.readdirSync(pendingDir), []);
assert.equal(fs.readdirSync(path.join(tmpRoot, "task-events", "applied")).length, 4);
assert.equal(fs.readdirSync(path.join(tmpRoot, "task-events", "rejected")).length, 4);

const reportPath = path.join(tmpRoot, "task-events", "latest-report.json");
const writtenReport = JSON.parse(fs.readFileSync(reportPath, "utf8"));
assert.equal(writtenReport.applied.length, 4);
assert.equal(writtenReport.rejected.length, 4);
assert.equal(writtenReport.duplicates.length, 1);

const syncPendingDir = path.join(tmpRoot, "sync-events", "pending");
const syncFiles = fs.readdirSync(syncPendingDir).sort();
assert.equal(syncFiles.length, 6);

const syncEvents = syncFiles.map((fileName) => JSON.parse(fs.readFileSync(path.join(syncPendingDir, fileName), "utf8")));
assert.equal(syncEvents.filter((event) => event.target === "obsidian_canvas").length, 4);
assert.equal(syncEvents.filter((event) => event.target === "heptabase_append").length, 1);
assert.equal(syncEvents.filter((event) => event.target === "notion_sentinel").length, 1);
assert.equal(syncEvents.every((event) => event.type === "sync_requested"), true);
assert.equal(syncEvents.every((event) => event.status === "pending"), true);

console.log("apply-task-events verification passed");

function writeEvent(fileName, event) {
  writeJson(path.join(pendingDir, fileName), event);
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
