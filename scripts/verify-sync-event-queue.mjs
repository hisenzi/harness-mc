import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as syncEventQueue from "./sync-event-queue.mjs";

const { skipSyncRequest, writeSyncEvent } = syncEventQueue;

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
  () => skipSyncRequest({
    root: tmpRoot,
    sync_event_id: event.sync_event_id,
    verifier: "demo verifier",
  }),
  /exemption_reason is required/,
);
assert.equal(fs.readdirSync(pendingDir).length, 2);

const skipped = skipSyncRequest({
  root: tmpRoot,
  sync_event_id: event.sync_event_id,
  exemption_reason: "Task has no binding to the requested optional mirror.",
  verifier: "external mirror binding inventory",
  actor: "codex",
  session_id: "session-123",
  resolved_at: "2026-06-15T09:05:00+08:00",
});
assert.equal(skipped.type, "sync_skipped");
assert.equal(skipped.status, "skipped");
assert.equal(skipped.sync_event_id, event.sync_event_id);
assert.equal(fs.readdirSync(pendingDir).length, 1);
const syncedDir = path.join(tmpRoot, "sync-events", "synced");
const skippedFiles = fs.readdirSync(syncedDir);
assert.equal(skippedFiles.length, 1);
assert.match(skippedFiles[0], /sync_skipped\.json$/);
assert.deepEqual(
  JSON.parse(fs.readFileSync(path.join(syncedDir, skippedFiles[0]), "utf8")),
  skipped,
);
assert.deepEqual(
  skipSyncRequest({
    root: tmpRoot,
    sync_event_id: event.sync_event_id,
    exemption_reason: "Task has no binding to the requested optional mirror.",
    verifier: "external mirror binding inventory",
    actor: "codex",
    session_id: "session-123",
  }),
  skipped,
);

assert.equal(
  typeof syncEventQueue.resolveSyncRequest,
  "function",
  "a successful delivery needs a terminal resolver",
);

const deliveredRequest = writeSyncEvent({
  root: tmpRoot,
  type: "sync_requested",
  target: "heptabase_append",
  source_event_id: "evt-complete-task-3",
  project: "demo-project",
  task_id: "task-2",
  reason: "task_state_changed",
  payload: {
    card_id: "card-123",
  },
  actor: "codex",
  session_id: "session-123",
  created_at: "2026-06-15T09:10:00+08:00",
});

const delivered = syncEventQueue.resolveSyncRequest({
  root: tmpRoot,
  sync_event_id: deliveredRequest.sync_event_id,
  delivery_evidence: "Heptabase card card-123 read-back matched canonical task state.",
  verifier: "heptabase card read-back",
  actor: "codex",
  session_id: "session-123",
  resolved_at: "2026-06-15T09:15:00+08:00",
});
assert.equal(delivered.type, "synced");
assert.equal(delivered.status, "synced");
assert.equal(delivered.sync_event_id, deliveredRequest.sync_event_id);
assert.equal(delivered.delivery_evidence, "Heptabase card card-123 read-back matched canonical task state.");
assert.equal(fs.readdirSync(pendingDir).length, 1);
assert.deepEqual(
  syncEventQueue.resolveSyncRequest({
    root: tmpRoot,
    sync_event_id: deliveredRequest.sync_event_id,
    delivery_evidence: "Heptabase card card-123 read-back matched canonical task state.",
    verifier: "heptabase card read-back",
    actor: "codex",
    session_id: "session-123",
  }),
  delivered,
);

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
