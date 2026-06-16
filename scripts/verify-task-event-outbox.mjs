import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeTaskEvent } from "./task-event-outbox.mjs";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "task-event-outbox-"));

const event = writeTaskEvent({
  root: tmpRoot,
  type: "task.completed",
  repo: "finance-dashboard",
  commit: "1f0bd74",
  project: "notion-finance",
  task_id: "mc-12",
  summary: "Persistent transfer checklist completed.",
  actor: "codex",
  session_id: "session-123",
  created_at: "2026-06-15T09:00:00+08:00",
});

assert.equal(event.project, "notion-finance");
assert.equal(event.task_id, "mc-12");
assert.equal(event.type, "task.completed");
assert.match(event.event_id, /^task\.completed-notion-finance-mc-12-1f0bd74-/);

const pendingDir = path.join(tmpRoot, "task-events", "pending");
const files = fs.readdirSync(pendingDir);
assert.equal(files.length, 1);
assert.match(files[0], /^20260615T010000Z-finance-dashboard-1f0bd74-notion-finance-mc-12\.json$/);

const written = JSON.parse(fs.readFileSync(path.join(pendingDir, files[0]), "utf8"));
assert.deepEqual(written, event);

assert.throws(
  () => writeTaskEvent({
    root: tmpRoot,
    type: "task.completed",
    repo: "finance-dashboard",
    commit: "1f0bd74",
    project: "notion-finance",
    summary: "missing task",
    actor: "codex",
    session_id: "session-123",
  }),
  /task_id is required/,
);

console.log("task-event-outbox verification passed");
