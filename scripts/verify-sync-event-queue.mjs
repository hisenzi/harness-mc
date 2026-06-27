import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeSyncEvent } from "./sync-event-queue.mjs";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sync-event-queue-"));

const event = writeSyncEvent({
  root: tmpRoot,
  type: "sync_requested",
  target: "obsidian_canvas",
  source_event_id: "evt-complete-task-1",
  project: "demo-project",
  task_id: "task-1",
  reason: "task_state_changed",
  payload: {
    whiteboard: "MC 儀表版",
  },
  actor: "codex",
  session_id: "session-123",
  created_at: "2026-06-15T09:00:00+08:00",
});

assert.equal(event.type, "sync_requested");
assert.equal(event.target, "obsidian_canvas");
assert.equal(event.status, "pending");
assert.match(event.sync_event_id, /^sync_requested-obsidian_canvas-demo-project-task-1-evt-complete-task-1-/);

const pendingDir = path.join(tmpRoot, "sync-events", "pending");
const files = fs.readdirSync(pendingDir);
assert.equal(files.length, 1);
assert.match(files[0], /^20260615T010000Z-obsidian_canvas-demo-project-task-1-evt-complete-task-1-sync_requested\.json$/);

const written = JSON.parse(fs.readFileSync(path.join(pendingDir, files[0]), "utf8"));
assert.deepEqual(written, event);

writeSyncEvent({
  root: tmpRoot,
  type: "sync_requested",
  target: "obsidian_canvas",
  source_event_id: "evt-complete-task-2",
  project: "demo-project",
  task_id: "task-1",
  reason: "task_state_changed",
  actor: "codex",
  session_id: "session-123",
  created_at: "2026-06-15T09:00:00+08:00",
});

assert.equal(fs.readdirSync(pendingDir).length, 2);

assert.throws(
  () => writeSyncEvent({
    root: tmpRoot,
    type: "sync_requested",
    target: "unknown_target",
    source_event_id: "evt",
    project: "demo-project",
    task_id: "task-1",
    reason: "task_state_changed",
    actor: "codex",
    session_id: "session-123",
  }),
  /unsupported sync target/,
);

console.log("sync-event-queue verification passed");
