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

  const allPendingFiles = fs
    .readdirSync(pendingDir)
    .filter((fileName) => fileName.endsWith(".json"))
    .sort();
  validateSelectedEventTargets(pendingDir, allPendingFiles, options.eventIds);
  const pendingFiles = selectPendingFiles(pendingDir, allPendingFiles, options.eventIds);

  validateManualRejectionReview(options.manualRejections, options.manualRejectionReview);
  validateManualRejectionTargets(pendingDir, pendingFiles, options.manualRejections);

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

    const manualRejectionReason = options.manualRejections?.get(eventId);
    if (manualRejectionReason) {
      seenEventIds.add(eventId);
      rejectEvent({
        source,
        fileName,
        event,
        reason: manualRejectionReason,
        manualReview: options.manualRejectionReview,
        rejectedDir,
        report,
      });
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
    projectTasks.touchedTaskIds.add(task.id);
    seenEventIds.add(eventId);

    moveEventFile(source, path.join(appliedDir, fileName), event, "applied");
    report.applied.push({ file: fileName, event_id: eventId, project: event.project, task_id: event.task_id, type: event.type });
  }

  for (const projectTasks of tasksCache.values()) {
    if (projectTasks?.dirty) {
      for (const taskId of projectTasks.touchedTaskIds) {
        const task = projectTasks.data.tasks.find((item) => item.id === taskId);
        if (task) projectTasks.state.tasks[task.id] = stateFromTask(task);
      }
      writeJson(projectTasks.statePath, projectTasks.state);
    }
  }

  if (pendingFiles.length > 0 && options.writeLatestReport !== false) {
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

function validateManualRejectionReview(manualRejections, review) {
  if (!(manualRejections instanceof Map) || manualRejections.size === 0) return;
  const isValid = review
    && typeof review === "object"
    && !Array.isArray(review)
    && review.approved_by === "Vincent"
    && isDateOnly(review.approved_at)
    && Array.isArray(review.evidence_refs)
    && review.evidence_refs.length > 0
    && review.evidence_refs.every((ref) => typeof ref === "string" && ref.trim().length > 0);
  if (!isValid) {
    throw new Error("manual rejection requires explicit Vincent approval evidence");
  }
}

function validateSelectedEventTargets(pendingDir, pendingFiles, eventIds) {
  if (!(eventIds instanceof Set)) return;
  const pendingEventIds = new Set(
    pendingFiles
      .map((fileName) => readJson(path.join(pendingDir, fileName))?.event_id)
      .filter(Boolean),
  );
  const missingEventIds = [...eventIds].filter((eventId) => !pendingEventIds.has(eventId));
  if (missingEventIds.length > 0) {
    throw new Error(`selected event_id not found in pending queue: ${missingEventIds.join(", ")}`);
  }
}

function selectPendingFiles(pendingDir, pendingFiles, eventIds) {
  if (!(eventIds instanceof Set)) return pendingFiles;
  return pendingFiles.filter((fileName) => {
    const eventId = readJson(path.join(pendingDir, fileName))?.event_id;
    return eventIds.has(eventId);
  });
}

function validateManualRejectionTargets(pendingDir, pendingFiles, manualRejections) {
  if (!(manualRejections instanceof Map) || manualRejections.size === 0) return;
  const pendingEventIds = new Set(
    pendingFiles
      .map((fileName) => readJson(path.join(pendingDir, fileName))?.event_id)
      .filter(Boolean),
  );
  const missingEventIds = [...manualRejections.keys()].filter((eventId) => !pendingEventIds.has(eventId));
  if (missingEventIds.length > 0) {
    throw new Error(`manual rejection event_id not found in pending queue: ${missingEventIds.join(", ")}`);
  }
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
    touchedTaskIds: new Set(),
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

function rejectEvent({ source, fileName, event, reason, manualReview, rejectedDir, report }) {
  const record = {
    rejected_at: new Date().toISOString(),
    reason,
    ...(manualReview ? { manual_review: manualReview } : {}),
    event,
  };
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

function isDateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isCli) {
  const report = applyTaskEvents(parseCliArgs(process.argv.slice(2)));
  console.log(JSON.stringify(report, null, 2));
}

function parseCliArgs(argv) {
  const eventIds = new Set();
  const manualRejections = new Map();
  const manualRejectionReview = { evidence_refs: [] };
  let hasManualReviewArg = false;
  let runGenerateData = true;
  let writeLatestReport = true;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--event-id") {
      const eventId = argv[++index] || "";
      if (!eventId) {
        throw new Error("--event-id requires a non-empty event_id");
      }
      eventIds.add(eventId);
    } else if (arg === "--reject-event") {
      const value = argv[++index] || "";
      const separator = value.indexOf("=");
      if (separator <= 0 || separator === value.length - 1) {
        throw new Error("--reject-event must be <event_id>=<reason>");
      }
      const eventId = value.slice(0, separator);
      const reason = value.slice(separator + 1);
      if (!/^[a-z][a-z0-9_]*$/.test(reason)) {
        throw new Error(`manual rejection reason must be a stable snake_case code: ${reason}`);
      }
      manualRejections.set(eventId, reason);
    } else if (arg === "--rejection-approved-by") {
      manualRejectionReview.approved_by = argv[++index] || "";
      hasManualReviewArg = true;
    } else if (arg === "--rejection-approved-at") {
      manualRejectionReview.approved_at = argv[++index] || "";
      hasManualReviewArg = true;
    } else if (arg === "--rejection-evidence-ref") {
      manualRejectionReview.evidence_refs.push(argv[++index] || "");
      hasManualReviewArg = true;
    } else if (arg === "--no-generate-data") {
      runGenerateData = false;
    } else if (arg === "--no-latest-report") {
      writeLatestReport = false;
    } else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/apply-task-events.mjs [--event-id <event_id>]... [--no-generate-data] [--no-latest-report] [--reject-event <event_id>=<reason> --rejection-approved-by Vincent --rejection-approved-at YYYY-MM-DD --rejection-evidence-ref <ref>]...");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (hasManualReviewArg && manualRejections.size === 0) {
    throw new Error("manual rejection approval fields require at least one --reject-event");
  }
  return {
    manualRejections,
    runGenerateData,
    writeLatestReport,
    ...(eventIds.size > 0 ? { eventIds } : {}),
    ...(manualRejections.size > 0 ? { manualRejectionReview } : {}),
  };
}
