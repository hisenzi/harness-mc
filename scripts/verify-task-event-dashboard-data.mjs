import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateTaskEventPipelineData } from "./generate-task-event-data.mjs";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "task-event-dashboard-"));

writeJson(path.join(tmpRoot, "task-events", "pending", "001-pending.json"), {
  event_id: "evt-pending",
  type: "task.completed",
  project: "demo-project",
  task_id: "task-1",
  created_at: "2026-06-15T09:00:00+08:00",
});

writeJson(path.join(tmpRoot, "task-events", "applied", "002-applied.json"), {
  event_id: "evt-applied",
  type: "task.blocked",
  project: "demo-project",
  task_id: "task-2",
  created_at: "2026-06-15T10:00:00+08:00",
});

writeJson(path.join(tmpRoot, "task-events", "rejected", "003-rejected.json"), {
  rejected_at: "2026-06-15T11:00:00+08:00",
  reason: "unknown_task",
  event: {
    event_id: "evt-rejected",
    type: "task.completed",
    project: "demo-project",
    task_id: "missing-task",
    created_at: "2026-06-15T11:00:00+08:00",
  },
});

writeJson(path.join(tmpRoot, "task-events", "latest-report.json"), {
  generated_at: "2026-06-15T12:00:00+08:00",
  applied: [{ event_id: "evt-applied" }],
  rejected: [{ event_id: "evt-rejected", reason: "unknown_task" }],
  duplicates: [{ event_id: "evt-duplicate" }],
});

writeJson(path.join(tmpRoot, "sync-events", "pending", "001-sync-pending.json"), {
  sync_event_id: "sync-pending",
  type: "sync_requested",
  target: "obsidian_canvas",
  project: "demo-project",
  task_id: "task-1",
  created_at: "2026-06-15T09:05:00+08:00",
});

writeJson(path.join(tmpRoot, "sync-events", "failed", "002-sync-failed.json"), {
  sync_event_id: "sync-failed",
  type: "sync_failed",
  target: "heptabase_append",
  project: "demo-project",
  task_id: "task-2",
  created_at: "2026-06-15T09:10:00+08:00",
});

const data = generateTaskEventPipelineData({ root: tmpRoot, write: false });

assert.equal(data.task_events.pending, 1);
assert.equal(data.task_events.applied, 1);
assert.equal(data.task_events.rejected, 1);
assert.equal(data.task_events.rejected_by_reason.unknown_task, 1);
assert.equal(data.sync_events.pending, 1);
assert.equal(data.sync_events.synced, 0);
assert.equal(data.sync_events.failed, 1);
assert.equal(data.sync_events.by_target.obsidian_canvas.pending, 1);
assert.equal(data.sync_events.by_target.heptabase_append.failed, 1);
assert.equal(data.latest_reducer_run.generated_at, "2026-06-15T12:00:00+08:00");
assert.equal(data.latest_reducer_run.applied, 1);
assert.equal(data.latest_reducer_run.rejected, 1);
assert.equal(data.latest_reducer_run.duplicates, 1);
assert.deepEqual(data.recent_task_events.map((event) => event.id), ["evt-rejected", "evt-applied", "evt-pending"]);
assert.deepEqual(data.recent_sync_events.map((event) => event.id), ["sync-failed", "sync-pending"]);

const written = generateTaskEventPipelineData({ root: tmpRoot, write: true });
assert.equal(written.task_events.pending, data.task_events.pending);
assert.equal(written.sync_events.pending, data.sync_events.pending);
assert.ok(fs.existsSync(path.join(tmpRoot, "public", "data", "task-events.json")));

console.log("task-event-dashboard data verification passed");

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
