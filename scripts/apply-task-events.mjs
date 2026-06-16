import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mergeTaskDefinitionsWithState, stateFromTask } from "./task-state.mjs";
import { writeSyncEvent } from "./sync-event-queue.mjs";

const SUPPORTED_TYPES = new Set([
  "task.completed",
  "task.commit_attached",
  "task.reopened",
  "task.blocked",
]);

export function applyTaskEvents(options = {}) {
  const root = options.root || process.cwd();
  const eventsRoot = path.join(root, "task-events");
  const pendingDir = path.join(eventsRoot, "pending");
  const appliedDir = path.join(eventsRoot, "applied");
  const rejectedDir = path.join(eventsRoot, "rejected");

  fs.mkdirSync(pendingDir, { recursive: true });
  fs.mkdirSync(appliedDir, { recursive: true });
  fs.mkdirSync(rejectedDir, { recursive: true });

  const pendingFiles = fs
    .readdirSync(pendingDir)
    .filter((fileName) => fileName.endsWith(".json"))
    .sort();

  const seenEventIds = collectProcessedEventIds(eventsRoot);
  const tasksCache = new Map();
  const report = {
    generated_at: new Date().toISOString(),
    applied: [],
    rejected: [],
    duplicates: [],
  };

  for (const fileName of pendingFiles) {
    const source = path.join(pendingDir, fileName);
    const event = readJson(source);
    const eventId = event?.event_id;

    if (!eventId) {
      rejectEvent({ source, fileName, event, reason: "missing_event_id", rejectedDir, report });
      continue;
    }

    if (seenEventIds.has(eventId)) {
      report.duplicates.push({ file: fileName, event_id: eventId });
      rejectEvent({ source, fileName, event, reason: "duplicate_event_id", rejectedDir, report });
      continue;
    }

    if (!SUPPORTED_TYPES.has(event.type)) {
      seenEventIds.add(eventId);
      rejectEvent({ source, fileName, event, reason: "unknown_type", rejectedDir, report });
      continue;
    }

    const projectTasks = loadProjectTasks(root, event.project, tasksCache);
    const task = projectTasks?.data?.tasks?.find((item) => item.id === event.task_id);

    if (!task) {
      seenEventIds.add(eventId);
      rejectEvent({ source, fileName, event, reason: "unknown_task", rejectedDir, report });
      continue;
    }

    applyEventToTask(task, event);
    enqueueSyncRequests(root, event, task);
    projectTasks.dirty = true;
    seenEventIds.add(eventId);

    moveEventFile(source, path.join(appliedDir, fileName), event, "applied");
    report.applied.push({ file: fileName, event_id: eventId, project: event.project, task_id: event.task_id, type: event.type });
  }

  for (const projectTasks of tasksCache.values()) {
    if (projectTasks?.dirty) {
      for (const task of projectTasks.data.tasks || []) {
        projectTasks.state.tasks[task.id] = stateFromTask(task);
      }
      writeJson(projectTasks.statePath, projectTasks.state);
    }
  }

  if (pendingFiles.length > 0) {
    writeJson(path.join(eventsRoot, "latest-report.json"), report);
  }

  if (options.runGenerateData !== false && report.applied.length > 0) {
    const result = spawnSync(process.execPath, ["scripts/generate-data.mjs"], {
      cwd: root,
      stdio: "inherit",
    });
    if (result.status !== 0) {
      throw new Error(`generate-data.mjs failed with exit code ${result.status}`);
    }
  }

  return report;
}

function collectProcessedEventIds(eventsRoot) {
  const ids = new Set();
  for (const dirName of ["applied", "rejected"]) {
    const dir = path.join(eventsRoot, dirName);
    if (!fs.existsSync(dir)) continue;
    for (const fileName of fs.readdirSync(dir)) {
      if (!fileName.endsWith(".json")) continue;
      const record = readJson(path.join(dir, fileName));
      const eventId = record?.event?.event_id || record?.event_id;
      if (eventId) ids.add(eventId);
    }
  }
  return ids;
}

function loadProjectTasks(root, project, tasksCache) {
  if (!project) return null;
  if (tasksCache.has(project)) return tasksCache.get(project);

  const tasksPath = path.join(root, "milestones", project, "tasks.json");
  if (!fs.existsSync(tasksPath)) {
    tasksCache.set(project, null);
    return null;
  }

  const projectTasks = {
    path: tasksPath,
    statePath: path.join(root, "milestones", project, "state.json"),
    definitions: readJson(tasksPath),
    state: {},
    data: null,
    dirty: false,
  };
  projectTasks.state = fs.existsSync(projectTasks.statePath) ? readJson(projectTasks.statePath) : { tasks: {} };
  if (!projectTasks.state.tasks) projectTasks.state.tasks = {};
  projectTasks.data = {
    ...projectTasks.definitions,
    tasks: mergeTaskDefinitionsWithState(projectTasks.definitions.tasks || [], projectTasks.state),
  };
  tasksCache.set(project, projectTasks);
  return projectTasks;
}

function applyEventToTask(task, event) {
  appendCommit(task, event.commit);

  if (event.type === "task.completed") {
    task.status = "completed";
    task.completed_at = dateOnly(event.created_at);
    return;
  }

  if (event.type === "task.reopened") {
    task.status = "in_progress";
    delete task.completed_at;
    return;
  }

  if (event.type === "task.blocked") {
    task.status = "blocked";
  }
}

function enqueueSyncRequests(root, event, task) {
  const base = {
    root,
    type: "sync_requested",
    source_event_id: event.event_id,
    project: event.project,
    task_id: event.task_id,
    actor: event.actor,
    session_id: event.session_id,
    created_at: event.created_at,
  };

  writeSyncEvent({
    ...base,
    target: "obsidian_canvas",
    reason: "task_state_changed",
    payload: {
      whiteboard: task.external_refs?.heptabase?.whiteboard || "MC 儀表版",
    },
  });

  if (task.external_refs?.heptabase?.card_id) {
    writeSyncEvent({
      ...base,
      target: "heptabase_append",
      reason: "task_state_changed",
      payload: {
        card_id: task.external_refs.heptabase.card_id,
        whiteboard: task.external_refs.heptabase.whiteboard || "",
        status: task.status,
        summary: event.summary,
        commit: event.commit,
      },
    });
  }

  if (event.type === "task.blocked") {
    writeSyncEvent({
      ...base,
      target: "notion_sentinel",
      reason: "task_blocked",
      payload: {
        status: task.status,
        summary: event.summary,
      },
    });
  }
}

function appendCommit(task, commit) {
  if (!commit) return;
  if (!Array.isArray(task.commits)) task.commits = [];
  if (!task.commits.includes(commit)) task.commits.push(commit);
}

function rejectEvent({ source, fileName, event, reason, rejectedDir, report }) {
  const record = { rejected_at: new Date().toISOString(), reason, event };
  moveEventFile(source, path.join(rejectedDir, fileName), record, "rejected");
  report.rejected.push({ file: fileName, event_id: event?.event_id, reason });
}

function moveEventFile(source, target, payload, status) {
  const finalTarget = uniquePath(target);
  fs.writeFileSync(finalTarget, `${JSON.stringify(payload, null, 2)}\n`, { flag: "wx" });
  fs.unlinkSync(source);
  return { path: finalTarget, status };
}

function uniquePath(target) {
  if (!fs.existsSync(target)) return target;

  const parsed = path.parse(target);
  let counter = 2;
  while (true) {
    const candidate = path.join(parsed.dir, `${parsed.name}-${counter}${parsed.ext}`);
    if (!fs.existsSync(candidate)) return candidate;
    counter += 1;
  }
}

function dateOnly(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isCli) {
  const report = applyTaskEvents();
  console.log(JSON.stringify(report, null, 2));
}
