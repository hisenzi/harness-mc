import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateVisualSyncCoverage } from "./generate-visual-sync-coverage.mjs";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "visual-sync-coverage-"));

writeJson(path.join(tmpRoot, "milestones", "harness-mc", "project.json"), {
  name: "Mission Control",
});

writeJson(path.join(tmpRoot, "milestones", "harness-mc", "tasks.json"), {
  tasks: [
    {
      id: "morrowise-card",
      title: "MorroWise visual-sync card",
      status: "completed",
      track: "control-plane",
      external_refs: {
        heptabase: {
          whiteboard: "MC 儀表版",
          card_id: "card-aligned",
          synced_at: "2026-06-20",
          sync_mode: "appended",
        },
      },
    },
    {
      id: "visual-sync-missing-card",
      title: "Visual sync missing card",
      status: "todo",
      track: "control-plane",
    },
    {
      id: "visual-sync-pending-canvas",
      title: "Visual sync pending canvas",
      status: "todo",
      track: "control-plane",
      external_refs: {
        heptabase: {
          whiteboard: "MC 儀表版",
          card_id: "card-pending-canvas",
          sync_mode: "appended",
        },
      },
    },
    {
      id: "visual-sync-failed-heptabase",
      title: "Visual sync failed heptabase",
      status: "todo",
      track: "control-plane",
      external_refs: {
        heptabase: {
          whiteboard: "MC 儀表版",
          card_id: "card-failed",
          synced_at: "2026-06-20",
        },
      },
    },
  ],
});

writeJson(path.join(tmpRoot, "milestones", "harness-mc", "state.json"), {
  tasks: {
    "visual-sync-missing-card": {
      external_refs: {
        heptabase: {
          whiteboard: "MC 儀表版",
        },
      },
    },
  },
});

writeJson(path.join(tmpRoot, "sync-events", "pending", "001-canvas.json"), {
  sync_event_id: "sync-canvas",
  type: "sync_requested",
  target: "obsidian_canvas",
  project: "harness-mc",
  task_id: "visual-sync-pending-canvas",
  reason: "task_state_changed",
  created_at: "2026-06-27T10:00:00+08:00",
  actor: "codex",
  session_id: "fixture",
});

writeJson(path.join(tmpRoot, "sync-events", "pending", "002-heptabase.json"), {
  sync_event_id: "sync-heptabase",
  type: "sync_requested",
  target: "heptabase_append",
  project: "harness-mc",
  task_id: "visual-sync-pending-canvas",
  reason: "task_state_changed",
  created_at: "2026-06-27T10:01:00+08:00",
  actor: "codex",
  session_id: "fixture",
});

writeJson(path.join(tmpRoot, "sync-events", "failed", "003-failed.json"), {
  sync_event_id: "sync-failed",
  type: "sync_failed",
  target: "heptabase_append",
  project: "harness-mc",
  task_id: "visual-sync-failed-heptabase",
  reason: "heptabase_cli_unavailable",
  created_at: "2026-06-27T10:02:00+08:00",
  actor: "codex",
  session_id: "fixture",
});

const data = generateVisualSyncCoverage({
  root: tmpRoot,
  generatedAt: "2026-06-27T10:05:00+08:00",
  write: false,
});

assert.equal(data.schema_version, "visual-sync-coverage.v0");
assert.equal(data.read_only, true);
assert.equal(data.write_boundary.mode, "read_only");
assert.ok(data.write_boundary.forbidden.includes("write Heptabase"));
assert.equal(data.summary.tracked_tasks, 4);
assert.equal(data.summary.aligned, 1);
assert.equal(data.summary.coverage_gaps, 3);
assert.equal(data.summary.missing_heptabase_card, 1);
assert.equal(data.summary.missing_canvas_synced_at, 1);
assert.equal(data.summary.pending_canvas_sync, 1);
assert.equal(data.summary.pending_heptabase_sync, 1);
assert.equal(data.summary.failed_heptabase_sync, 1);
assert.equal(data.queues.by_target.obsidian_canvas.pending, 1);
assert.equal(data.queues.by_target.heptabase_append.pending, 1);
assert.equal(data.queues.by_target.heptabase_append.failed, 1);
assert.equal(data.next_action.type, "review_failed_sync_events");

const missingCard = data.tracked_tasks.find((task) => task.task_id === "visual-sync-missing-card");
assert.ok(missingCard.gaps.includes("missing_heptabase_card"));
assert.equal(missingCard.heptabase.whiteboard, "MC 儀表版");

const pendingCanvas = data.tracked_tasks.find((task) => task.task_id === "visual-sync-pending-canvas");
assert.ok(pendingCanvas.gaps.includes("missing_canvas_synced_at"));
assert.ok(pendingCanvas.gaps.includes("pending_canvas_sync"));
assert.ok(pendingCanvas.gaps.includes("pending_heptabase_sync"));
assert.equal(pendingCanvas.sync_events.length, 2);

const aligned = data.tracked_tasks.find((task) => task.task_id === "morrowise-card");
assert.equal(aligned.coverage_state, "aligned");

const written = generateVisualSyncCoverage({ root: tmpRoot, write: true });
assert.equal(written.summary.tracked_tasks, data.summary.tracked_tasks);
assert.ok(fs.existsSync(path.join(tmpRoot, "public", "data", "visual-sync-coverage.json")));

console.log("Visual sync coverage verification OK");

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
