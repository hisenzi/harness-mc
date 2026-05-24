import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const milestonesDir = path.join(root, "milestones");
const outPath = path.join(root, "public", "data", "projects.json");

function normalize(t) {
  return {
    id: t.id || "",
    title: t.title || t.description || "",
    status: t.status || "not_started",
    track: t.track || "dev",
    foundation: t.foundation ?? null,
    issues_found: t.issues_found ?? 0,
    issues_fixed: t.issues_fixed ?? 0,
    verdict: t.verdict ?? null,
    note: t.note || "",
    completed_at: t.completed_at || null,
    commits: t.commits || [],
    summary: t.summary || "",
  };
}

const results = [];

for (const dir of fs.readdirSync(milestonesDir)) {
  const tasksPath = path.join(milestonesDir, dir, "tasks.json");
  if (!fs.existsSync(tasksPath)) continue;

  try {
    const raw = JSON.parse(fs.readFileSync(tasksPath, "utf-8").replace(/^﻿/, ""));
    const tasks = [];

    if (Array.isArray(raw)) {
      for (const t of raw) tasks.push(normalize(t));
    } else if (Array.isArray(raw.tasks)) {
      for (const t of raw.tasks) tasks.push(normalize(t));
    } else if (Array.isArray(raw.dev)) {
      for (const t of [...raw.dev, ...(raw.ops || [])]) tasks.push(normalize(t));
    } else if (Array.isArray(raw.phases)) {
      for (const phase of raw.phases) {
        if (Array.isArray(phase.tasks)) {
          for (const t of phase.tasks) tasks.push(normalize({ ...t, track: t.track || phase.id }));
        }
      }
    }

    if (tasks.length === 0) continue;

    let meta = {};
    const projectPath = path.join(milestonesDir, dir, "project.json");
    if (fs.existsSync(projectPath)) {
      meta = JSON.parse(fs.readFileSync(projectPath, "utf-8").replace(/^﻿/, ""));
    }

    const stat = fs.statSync(tasksPath);
    const done = tasks.filter((t) => ["done", "completed", "fixed"].includes(t.status)).length;

    const projectStatus = meta.status || "active";
    if (projectStatus === "archived") continue;

    results.push({
      project: dir,
      name: meta.name || dir,
      description: meta.description || "",
      status: projectStatus,
      type: meta.type || "other",
      priority: meta.priority || "medium",
      tasks,
      lastModified: stat.mtime.toISOString(),
      done,
      total: tasks.length,
      tracks: meta.tracks || {},
    });
  } catch {
    // skip malformed
  }
}

// Split self-learning: system tasks → projects.json, courses → learning.json
const COURSE_TRACKS = new Set(["course", "book", "free", "yt"]);
const learningOutPath = path.join(root, "public", "data", "learning.json");
let learningData = null;

for (const p of results) {
  if (p.project === "self-learning") {
    const courseTasks = p.tasks.filter((t) => COURSE_TRACKS.has(t.track));
    const systemTasks = p.tasks.filter((t) => !COURSE_TRACKS.has(t.track));

    const byStatus = { now: 0, next: 0, someday: 0, done: 0 };
    const byType = {};
    for (const t of courseTasks) {
      if (t.status === "in_progress") byStatus.now++;
      else if (t.status === "todo") byStatus.next++;
      else if (t.status === "done") byStatus.done++;
      else byStatus.someday++;
      byType[t.track] = (byType[t.track] || 0) + 1;
    }

    learningData = {
      summary: { total: courseTasks.length, ...byStatus, byType },
      courses: courseTasks.map((t) => {
        const parts = (t.note || "").split(" | ");
        const parsed = {};
        for (const part of parts) {
          if (part.startsWith("柱:")) parsed.pillar = part.slice(2);
          else if (part.startsWith("T:")) parsed.triage = Number(part.slice(2)) || 0;
          else if (part.startsWith("E:")) parsed.energy = part.slice(2);
          else if (part.endsWith("%")) parsed.pct = Number(part.replace("%", "")) || 0;
          else if (part.startsWith("http")) parsed.link = part;
        }
        return { ...t, ...parsed };
      }),
    };

    p.tasks = systemTasks;
    p.done = systemTasks.filter((t) => ["done", "completed", "fixed"].includes(t.status)).length;
    p.total = systemTasks.length;
    break;
  }
}

results.sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime());

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
console.log(`Generated ${outPath} — ${results.length} projects, ${results.reduce((s, p) => s + p.total, 0)} tasks`);

if (learningData) {
  fs.writeFileSync(learningOutPath, JSON.stringify(learningData, null, 2));
  console.log(`Generated ${learningOutPath} — ${learningData.summary.total} courses`);
}
