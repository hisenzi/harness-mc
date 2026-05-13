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
    }

    if (tasks.length === 0) continue;

    let meta = {};
    const projectPath = path.join(milestonesDir, dir, "project.json");
    if (fs.existsSync(projectPath)) {
      meta = JSON.parse(fs.readFileSync(projectPath, "utf-8").replace(/^﻿/, ""));
    }

    const stat = fs.statSync(tasksPath);
    const done = tasks.filter((t) => ["done", "completed", "fixed"].includes(t.status)).length;

    results.push({
      project: dir,
      name: meta.name || dir,
      description: meta.description || "",
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

results.sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime());

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
console.log(`Generated ${outPath} — ${results.length} projects, ${results.reduce((s, p) => s + p.total, 0)} tasks`);
