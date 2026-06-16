import fs from "node:fs";
import path from "node:path";

const REQUIRED_FIELDS = [
  "type",
  "target",
  "source_event_id",
  "project",
  "task_id",
  "reason",
  "actor",
  "session_id",
];

const SUPPORTED_TYPES = new Set(["sync_requested", "synced", "sync_failed"]);
const SUPPORTED_TARGETS = new Set(["heptabase_append", "obsidian_canvas", "notion_sentinel"]);

export function writeSyncEvent(input) {
  validateSyncEventInput(input);

  const createdAt = input.created_at || new Date().toISOString();
  const event = {
    sync_event_id: input.sync_event_id || buildSyncEventId(input, createdAt),
    type: input.type,
    target: input.target,
    status: statusForSyncType(input.type),
    source_event_id: input.source_event_id,
    project: input.project,
    task_id: input.task_id,
    reason: input.reason,
    payload: input.payload || {},
    created_at: createdAt,
    actor: input.actor,
    session_id: input.session_id,
  };

  const queueDir = path.join(input.root || process.cwd(), "sync-events", queueNameForType(input.type));
  fs.mkdirSync(queueDir, { recursive: true });

  const fileName = `${timestampSlug(createdAt)}-${slug(input.target)}-${slug(input.project)}-${slug(input.task_id)}-${slug(input.type)}.json`;
  const target = path.join(queueDir, fileName);
  fs.writeFileSync(target, `${JSON.stringify(event, null, 2)}\n`, { flag: "wx" });

  return event;
}

function validateSyncEventInput(input) {
  for (const field of REQUIRED_FIELDS) {
    if (!input?.[field]) throw new Error(`${field} is required`);
  }

  if (!SUPPORTED_TYPES.has(input.type)) {
    throw new Error(`unsupported sync event type: ${input.type}`);
  }

  if (!SUPPORTED_TARGETS.has(input.target)) {
    throw new Error(`unsupported sync target: ${input.target}`);
  }
}

function statusForSyncType(type) {
  if (type === "synced") return "synced";
  if (type === "sync_failed") return "failed";
  return "pending";
}

function queueNameForType(type) {
  if (type === "synced") return "synced";
  if (type === "sync_failed") return "failed";
  return "pending";
}

function buildSyncEventId(input, createdAt) {
  return `${input.type}-${slug(input.target)}-${slug(input.project)}-${slug(input.task_id)}-${slug(input.source_event_id)}-${timestampSlug(createdAt)}`;
}

function timestampSlug(value) {
  return new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function slug(value) {
  return String(value).trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}
