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

  const fileName = `${timestampSlug(createdAt)}-${slug(input.target)}-${slug(input.project)}-${slug(input.task_id)}-${slug(input.source_event_id)}-${slug(input.type)}.json`;
  const target = path.join(queueDir, fileName);
  const serialized = `${JSON.stringify(event, null, 2)}\n`;
  try {
    fs.writeFileSync(target, serialized, { flag: "wx" });
  } catch (error) {
    if (error?.code !== "EEXIST" || fs.readFileSync(target, "utf8") !== serialized) throw error;
  }

  return event;
}

export function resolveSyncRequest(input) {
  for (const field of [
    "sync_event_id",
    "delivery_evidence",
    "verifier",
    "actor",
    "session_id",
  ]) {
    if (!input?.[field]) throw new Error(`${field} is required`);
  }

  const root = input.root || process.cwd();
  const pendingDir = path.join(root, "sync-events", "pending");
  const syncedDir = path.join(root, "sync-events", "synced");
  const pendingMatches = findSyncEvents(pendingDir, input.sync_event_id);

  if (pendingMatches.length === 0) {
    const terminalMatches = findSyncEvents(syncedDir, input.sync_event_id)
      .filter(({ event }) => event.type === "synced");
    if (terminalMatches.length === 1) return terminalMatches[0].event;
    throw new Error(`pending sync_event_id not found: ${input.sync_event_id}`);
  }
  if (pendingMatches.length > 1) {
    throw new Error(`duplicate pending sync_event_id: ${input.sync_event_id}`);
  }

  const [{ fileName, filePath, event: request }] = pendingMatches;
  if (request.type !== "sync_requested" || request.status !== "pending") {
    throw new Error(`sync_event_id is not a pending request: ${input.sync_event_id}`);
  }

  const synced = {
    ...request,
    type: "synced",
    status: "synced",
    delivery_evidence: input.delivery_evidence,
    verifier: input.verifier,
    resolved_at: input.resolved_at || new Date().toISOString(),
    resolved_by: input.actor,
    resolution_session_id: input.session_id,
  };
  fs.mkdirSync(syncedDir, { recursive: true });
  const targetName = fileName.replace(/sync_requested\.json$/, "synced.json");
  const target = path.join(syncedDir, targetName);
  fs.writeFileSync(target, `${JSON.stringify(synced, null, 2)}\n`, { flag: "wx" });
  fs.unlinkSync(filePath);
  return synced;
}

export function skipSyncRequest(input) {
  for (const field of [
    "sync_event_id",
    "exemption_reason",
    "verifier",
    "actor",
    "session_id",
  ]) {
    if (!input?.[field]) throw new Error(`${field} is required`);
  }

  const root = input.root || process.cwd();
  const pendingDir = path.join(root, "sync-events", "pending");
  const syncedDir = path.join(root, "sync-events", "synced");
  const pendingMatches = findSyncEvents(pendingDir, input.sync_event_id);

  if (pendingMatches.length === 0) {
    const terminalMatches = findSyncEvents(syncedDir, input.sync_event_id)
      .filter(({ event }) => event.type === "sync_skipped");
    if (terminalMatches.length === 1) return terminalMatches[0].event;
    throw new Error(`pending sync_event_id not found: ${input.sync_event_id}`);
  }
  if (pendingMatches.length > 1) {
    throw new Error(`duplicate pending sync_event_id: ${input.sync_event_id}`);
  }

  const [{ fileName, filePath, event: request }] = pendingMatches;
  if (request.type !== "sync_requested" || request.status !== "pending") {
    throw new Error(`sync_event_id is not a pending request: ${input.sync_event_id}`);
  }

  const skipped = {
    ...request,
    type: "sync_skipped",
    status: "skipped",
    exemption_reason: input.exemption_reason,
    verifier: input.verifier,
    resolved_at: input.resolved_at || new Date().toISOString(),
    resolved_by: input.actor,
    resolution_session_id: input.session_id,
  };
  fs.mkdirSync(syncedDir, { recursive: true });
  const targetName = fileName.replace(/sync_requested\.json$/, "sync_skipped.json");
  const target = path.join(syncedDir, targetName);
  fs.writeFileSync(target, `${JSON.stringify(skipped, null, 2)}\n`, { flag: "wx" });
  fs.unlinkSync(filePath);
  return skipped;
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

function findSyncEvents(dir, syncEventId) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((fileName) => fileName.endsWith(".json"))
    .map((fileName) => {
      const filePath = path.join(dir, fileName);
      return {
        fileName,
        filePath,
        event: JSON.parse(fs.readFileSync(filePath, "utf8")),
      };
    })
    .filter(({ event }) => event.sync_event_id === syncEventId);
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
