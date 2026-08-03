import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mergeTaskDefinitionsWithState } from "./task-state.mjs";
import { discoverMilestoneProjects } from "./lib/milestone-projects.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(__dirname, "..");

const TRACKED_PROJECTS = new Set(["harness-mc", "notyet-md", "writing-system"]);
const TRACKED_NEEDLES = ["morrowise", "visual-sync", "brand-", "article-seed"];

export function generateVisualSyncCoverage(options = {}) {
  const root = options.root || defaultRoot;
  const generatedAt = options.generatedAt || new Date().toISOString();
  const projects = readProjects(root);
  const syncEvents = readSyncEvents(root);
  const syncByTask = groupSyncEventsByTask(syncEvents);
  const tasks = trackedTasks(projects, syncByTask);
  const items = tasks.map((task) => classifyTask(task, syncByTask.get(taskKey(task.project, task.id)) || []));

  const data = {
    schema_version: "visual-sync-coverage.v0",
    generated_at: generatedAt,
    read_only: true,
    source_of_truth: "canonical_mc_tasks_and_sync_event_queues",
    source_files: [
      "$COLLAB/harness-mc/milestones/*/tasks.json",
      "$COLLAB/harness-mc/milestones/*/state.json",
      "$COLLAB/harness-mc/sync-events/**/*.json",
    ],
    generator: "scripts/generate-visual-sync-coverage.mjs",
    tracked_scope: {
      projects: [...TRACKED_PROJECTS],
      needles: TRACKED_NEEDLES,
      inclusion_rules: [
        "task has external_refs.heptabase",
        "task.completed_at is 2026-06-20 for legacy visual-sync rollout coverage",
        "task belongs to tracked project and id/title/summary contains a tracked needle",
        "task has pending/synced/failed sync-events",
      ],
    },
    summary: summarize(items, syncEvents),
    queues: summarizeQueues(syncEvents),
    columns: buildColumns(items),
    coverage_gaps: items.filter((item) => item.gaps.length > 0),
    tracked_tasks: items,
    next_action: nextAction(items, syncEvents),
    write_boundary: {
      mode: "read_only",
      allowed: ["scan MC task refs", "scan sync-events queues", "report coverage gaps"],
      forbidden: ["write Heptabase", "write Obsidian Canvas", "modify task state", "move sync-events between queues"],
    },
    verifier_ref: "npm run test:visual-sync-coverage",
  };

  if (options.write !== false) {
    const outPath = path.join(root, "public", "data", "visual-sync-coverage.json");
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(data, null, 2)}\n`);
    console.log(`Generated ${outPath} — ${data.summary.tracked_tasks} tracked, ${data.summary.coverage_gaps} gaps`);
  }

  return data;
}

function readProjects(root) {
  return discoverMilestoneProjects({ repoRoot: root })
    .map((descriptor) => {
      const projectId = descriptor.projectId;
      const raw = readJson(descriptor.tasksPath);
      const projectMeta = fs.existsSync(descriptor.projectPath) ? readJson(descriptor.projectPath) : {};
      const state = fs.existsSync(descriptor.statePath) ? readJson(descriptor.statePath) : {};
      const tasks = extractTasks(raw);
      const merged = mergeTaskDefinitionsWithState(tasks, state);

      return {
        project: projectId,
        name: projectMeta.name || projectId,
        tasks: merged.map((task) => normalizeTask(task, projectId, projectMeta.name || projectId)),
      };
    });
}

function extractTasks(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.tasks)) return raw.tasks;
  if (Array.isArray(raw.dev) || Array.isArray(raw.ops)) return [...(raw.dev || []), ...(raw.ops || [])];
  if (Array.isArray(raw.phases)) {
    return raw.phases.flatMap((phase) => (phase.tasks || []).map((task) => ({ ...task, track: task.track || phase.id })));
  }
  return [];
}

function normalizeTask(task, project, projectName) {
  return {
    id: task.id || "",
    title: task.title || task.description || "",
    status: task.status || "todo",
    track: task.track || "",
    order_label: task.order_label || "",
    completed_at: task.completed_at || null,
    summary: task.summary || "",
    external_refs: task.external_refs || {},
    project,
    project_name: projectName,
  };
}

function readSyncEvents(root) {
  return ["pending", "synced", "failed"].flatMap((queue) => {
    const dir = path.join(root, "sync-events", queue);
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((fileName) => fileName.endsWith(".json"))
      .sort()
      .map((fileName) => {
        const event = readJson(path.join(dir, fileName));
        return {
          id: event.sync_event_id || fileName,
          queue,
          status: event.status || queue,
          type: event.type || "unknown",
          target: event.target || "unknown",
          project: event.project || "",
          task_id: event.task_id || "",
          reason: event.reason || "",
          created_at: event.created_at || "",
          file: fileName,
          payload: event.payload || {},
        };
      });
  });
}

function groupSyncEventsByTask(events) {
  const grouped = new Map();
  for (const event of events) {
    const key = taskKey(event.project, event.task_id);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(event);
  }
  return grouped;
}

function trackedTasks(projects, syncByTask) {
  const tasks = projects.flatMap((project) => project.tasks);
  const keyed = new Map(tasks.map((task) => [taskKey(task.project, task.id), task]));
  const tracked = tasks.filter((task) => shouldTrackTask(task));

  for (const key of syncByTask.keys()) {
    const task = keyed.get(key);
    if (task && !tracked.includes(task)) tracked.push(task);
  }

  return tracked.sort((a, b) => visualSyncRank(a, syncByTask.get(taskKey(a.project, a.id)) || [])
    - visualSyncRank(b, syncByTask.get(taskKey(b.project, b.id)) || [])
    || a.project.localeCompare(b.project)
    || a.id.localeCompare(b.id));
}

function shouldTrackTask(task) {
  const haystack = `${task.id} ${task.title} ${task.summary}`.toLowerCase();
  return Boolean(task.external_refs?.heptabase)
    || task.completed_at === "2026-06-20"
    || (TRACKED_PROJECTS.has(task.project) && TRACKED_NEEDLES.some((needle) => haystack.includes(needle)));
}

function classifyTask(task, syncEvents) {
  const heptabase = task.external_refs?.heptabase || {};
  const pending = syncEvents.filter((event) => event.queue === "pending");
  const failed = syncEvents.filter((event) => event.queue === "failed");
  const pendingTargets = new Set(pending.map((event) => event.target));
  const failedTargets = new Set(failed.map((event) => event.target));
  const gaps = [];

  if (!heptabase.card_id) gaps.push("missing_heptabase_card");
  if (heptabase.card_id && !heptabase.whiteboard) gaps.push("missing_heptabase_whiteboard");
  if (heptabase.card_id && !heptabase.synced_at) gaps.push("missing_canvas_synced_at");
  if (pendingTargets.has("heptabase_append")) gaps.push("pending_heptabase_sync");
  if (pendingTargets.has("obsidian_canvas")) gaps.push("pending_canvas_sync");
  if (failedTargets.has("heptabase_append")) gaps.push("failed_heptabase_sync");
  if (failedTargets.has("obsidian_canvas")) gaps.push("failed_canvas_sync");

  return {
    project: task.project,
    project_name: task.project_name,
    task_id: task.id,
    title: task.title,
    status: task.status,
    track: task.track,
    order_label: task.order_label,
    heptabase: {
      card_id: heptabase.card_id || null,
      whiteboard: heptabase.whiteboard || null,
      synced_at: heptabase.synced_at || null,
      sync_mode: heptabase.sync_mode || null,
    },
    sync_events: syncEvents
      .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
      .map((event) => ({
        id: event.id,
        queue: event.queue,
        target: event.target,
        created_at: event.created_at,
        file: event.file,
      })),
    gaps,
    coverage_state: gaps.length === 0 ? "aligned" : failed.length > 0 ? "failed" : pending.length > 0 ? "pending_sync" : "missing_refs",
  };
}

function summarize(items, syncEvents) {
  const tracked = items.length;
  const aligned = items.filter((item) => item.coverage_state === "aligned").length;
  const gaps = items.filter((item) => item.gaps.length > 0).length;
  return {
    tracked_tasks: tracked,
    aligned,
    coverage_gaps: gaps,
    coverage_percent: tracked === 0 ? 100 : Math.round((aligned / tracked) * 100),
    missing_heptabase_card: countGap(items, "missing_heptabase_card"),
    missing_heptabase_whiteboard: countGap(items, "missing_heptabase_whiteboard"),
    missing_canvas_synced_at: countGap(items, "missing_canvas_synced_at"),
    pending_heptabase_sync: countGap(items, "pending_heptabase_sync"),
    pending_canvas_sync: countGap(items, "pending_canvas_sync"),
    failed_heptabase_sync: countGap(items, "failed_heptabase_sync"),
    failed_canvas_sync: countGap(items, "failed_canvas_sync"),
    sync_events_pending: syncEvents.filter((event) => event.queue === "pending").length,
    sync_events_failed: syncEvents.filter((event) => event.queue === "failed").length,
  };
}

function summarizeQueues(syncEvents) {
  const targets = {};
  for (const event of syncEvents) {
    if (!targets[event.target]) targets[event.target] = { pending: 0, synced: 0, failed: 0 };
    targets[event.target][event.queue] += 1;
  }
  return {
    pending: syncEvents.filter((event) => event.queue === "pending").length,
    synced: syncEvents.filter((event) => event.queue === "synced").length,
    failed: syncEvents.filter((event) => event.queue === "failed").length,
    by_target: targets,
  };
}

function buildColumns(items) {
  return {
    missing_heptabase: items.filter((item) => item.gaps.includes("missing_heptabase_card")).slice(0, 8),
    canvas_pending: items.filter((item) => item.gaps.some((gap) => ["missing_canvas_synced_at", "pending_canvas_sync", "failed_canvas_sync"].includes(gap))).slice(0, 8),
    heptabase_pending: items.filter((item) => item.gaps.some((gap) => ["missing_heptabase_whiteboard", "pending_heptabase_sync", "failed_heptabase_sync"].includes(gap))).slice(0, 8),
    aligned: items.filter((item) => item.coverage_state === "aligned").slice(0, 8),
  };
}

function nextAction(items, syncEvents) {
  const failed = syncEvents.filter((event) => event.queue === "failed").length;
  const pending = syncEvents.filter((event) => event.queue === "pending").length;
  const missingRefs = items.filter((item) => item.gaps.some((gap) => gap.startsWith("missing_"))).length;

  if (failed > 0) {
    return { type: "review_failed_sync_events", target: "sync-events/failed", label: "Review failed visual/external sync events before retrying." };
  }
  if (pending > 0) {
    return { type: "process_sync_queue", target: "sync-events/pending", label: "Process pending Canvas / Heptabase sync requests through the approved sync actor." };
  }
  if (missingRefs > 0) {
    return { type: "backfill_external_refs", target: "harness-mc/acp-visual-sync-coverage-report", label: "Backfill missing Heptabase refs or mark tasks intentionally unmirrored." };
  }
  return { type: "none", target: null, label: "Visual sync coverage is aligned for the tracked scope." };
}

function visualSyncRank(task, syncEvents) {
  const item = classifyTask(task, syncEvents);
  if (item.coverage_state === "failed") return 0;
  if (item.coverage_state === "pending_sync") return 1;
  if (item.coverage_state === "missing_refs") return 2;
  return 3;
}

function countGap(items, gap) {
  return items.filter((item) => item.gaps.includes(gap)).length;
}

function taskKey(project, taskId) {
  return `${project || ""}::${taskId || ""}`;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isCli) generateVisualSyncCoverage();
