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
assert.match(files[0], /^20260615T010000Z-finance-dashboard-task\.completed-1f0bd74-notion-finance-mc-12\.json$/);

const written = JSON.parse(fs.readFileSync(path.join(pendingDir, files[0]), "utf8"));
assert.deepEqual(written, event);

const claimed = writeTaskEvent({
  root: tmpRoot,
  type: "task.claimed",
  repo: "harness-mc",
  project: "morrowise",
  task_id: "multi-machine-repo-coordination-gate",
  summary: "Integrator claim acquired before any commit exists.",
  actor: "codex",
  session_id: "session-claim",
  created_at: "2026-08-12T10:00:00+08:00",
  coordination: {
    claim_id: "claim-jv37-session-a",
    repo_class: "shared_core_multi_writer",
    branch: "main",
    base_sha: "a".repeat(40),
    claimed_at: "2026-08-12T10:00:00+08:00",
    owner_role: "integrator",
    actor: "codex",
    session_id: "session-claim",
    remote_claim_ref: "refs/jv37/claims/morrowise/multi-machine-repo-coordination-gate",
    remote_claim_sha: "b".repeat(40),
    remote_state: "claimed",
  },
});
assert.equal(Object.hasOwn(claimed, "commit"), false, "claim must not invent a commit");
assert.equal(claimed.coordination.claim_id, "claim-jv37-session-a");
assert.equal(fs.readdirSync(pendingDir).some((file) => file.includes("claim-jv37-session-a")), true);

const released = writeTaskEvent({
  root: tmpRoot,
  type: "task.released",
  repo: "harness-mc",
  project: "morrowise",
  task_id: "multi-machine-repo-coordination-gate",
  summary: "Same-second release must not collide with the claim filename.",
  actor: "codex",
  session_id: "session-claim",
  created_at: "2026-08-12T10:00:00+08:00",
  coordination: {
    ...claimed.coordination,
    remote_claim_sha: "c".repeat(40),
    remote_state: "released",
  },
});
assert.equal(released.type, "task.released");
assert.equal(fs.readdirSync(pendingDir).filter((file) => file.includes("claim-jv37-session-a")).length, 2);

assert.throws(
  () => writeTaskEvent({
    root: tmpRoot,
    type: "task.claimed",
    repo: "harness-mc",
    project: "morrowise",
    task_id: "multi-machine-repo-coordination-gate",
    summary: "Invalid claim without durable coordination metadata.",
    actor: "codex",
    session_id: "session-claim",
  }),
  /coordination is required for task\.claimed/,
);

assert.throws(
  () => writeTaskEvent({
    root: tmpRoot,
    type: "task.remote_synced",
    repo: "harness-mc",
    project: "morrowise",
    task_id: "multi-machine-repo-coordination-gate",
    summary: "Invalid remote sync without commit.",
    actor: "codex",
    session_id: "session-claim",
    coordination: claimed.coordination,
  }),
  /commit is required for task\.remote_synced/,
);

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
