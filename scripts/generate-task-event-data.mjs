import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(__dirname, "..");

export function generateTaskEventPipelineData(options = {}) {
  const root = options.root || defaultRoot;
  const taskEvents = readTaskEventQueues(root);
  const syncEvents = readSyncEventQueues(root);
  const latestReducerRun = readLatestReducerRun(root);

  const data = {
    generated_at: new Date().toISOString(),
    task_events: {
      pending: taskEvents.pending.length,
      applied: taskEvents.applied.length,
      rejected: taskEvents.rejected.length,
      rejected_by_reason: countBy(taskEvents.rejected, (event) => event.reason || "unknown"),
    },
    sync_events: {
      pending: syncEvents.pending.length,
      synced: syncEvents.synced.length,
      failed: syncEvents.failed.length,
      by_target: countSyncByTarget([...syncEvents.pending, ...syncEvents.synced, ...syncEvents.failed]),
    },
    latest_reducer_run: latestReducerRun,
    recent_task_events: recent([...taskEvents.pending, ...taskEvents.applied, ...taskEvents.rejected], 8),
    recent_sync_events: recent([...syncEvents.pending, ...syncEvents.synced, ...syncEvents.failed], 8),
  };

  if (options.write !== false) {
    const outPath = path.join(root, "public", "data", "task-events.json");
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(data, null, 2)}\n`);
    console.log(`Generated ${outPath} — ${data.task_events.pending} pending task events, ${data.sync_events.pending} pending sync events`);
  }

  return data;
}

function readTaskEventQueues(root) {
  return {
    pending: readQueue(path.join(root, "task-events", "pending"), normalizeTaskEvent("pending")),
    applied: readQueue(path.join(root, "task-events", "applied"), normalizeTaskEvent("applied")),
    rejected: readQueue(path.join(root, "task-events", "rejected"), normalizeRejectedTaskEvent),
  };
}

function readSyncEventQueues(root) {
  return {
    pending: readQueue(path.join(root, "sync-events", "pending"), normalizeSyncEvent("pending")),
    synced: readQueue(path.join(root, "sync-events", "synced"), normalizeSyncEvent("synced")),
    failed: readQueue(path.join(root, "sync-events", "failed"), normalizeSyncEvent("failed")),
  };
}

function readLatestReducerRun(root) {
  const reportPath = path.join(root, "task-events", "latest-report.json");
  if (!fs.existsSync(reportPath)) return null;
  const report = readJson(reportPath);
  return {
    generated_at: report.generated_at || null,
    applied: Array.isArray(report.applied) ? report.applied.length : 0,
    rejected: Array.isArray(report.rejected) ? report.rejected.length : 0,
    duplicates: Array.isArray(report.duplicates) ? report.duplicates.length : 0,
  };
}

function readQueue(dir, normalize) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((fileName) => fileName.endsWith(".json"))
    .sort()
    .map((fileName) => normalize(readJson(path.join(dir, fileName)), fileName));
}

function normalizeTaskEvent(queue) {
  return (event, fileName) => ({
    id: event.event_id || fileName,
    queue,
    type: event.type || "unknown",
    project: event.project || "",
    task_id: event.task_id || "",
    created_at: event.created_at || "",
    file: fileName,
  });
}

function normalizeRejectedTaskEvent(record, fileName) {
  const event = record.event || record;
  return {
    id: event.event_id || fileName,
    queue: "rejected",
    type: event.type || "unknown",
    project: event.project || "",
    task_id: event.task_id || "",
    created_at: record.rejected_at || event.created_at || "",
    reason: record.reason || "unknown",
    file: fileName,
  };
}

function normalizeSyncEvent(queue) {
  return (event, fileName) => ({
    id: event.sync_event_id || fileName,
    queue,
    type: event.type || "unknown",
    target: event.target || "unknown",
    project: event.project || "",
    task_id: event.task_id || "",
    created_at: event.created_at || "",
    file: fileName,
  });
}

function countBy(items, getKey) {
  const counts = {};
  for (const item of items) {
    const key = getKey(item);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function countSyncByTarget(items) {
  const counts = {};
  for (const item of items) {
    if (!counts[item.target]) counts[item.target] = { pending: 0, synced: 0, failed: 0 };
    counts[item.target][item.queue] += 1;
  }
  return counts;
}

function recent(items, limit) {
  return items
    .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
    .slice(0, limit);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isCli) generateTaskEventPipelineData();
