import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { MILESTONES_DIR } from "@/lib/paths";

interface Task {
  id: string;
  title: string;
  status: string;
  track: string;
  foundation?: string | null;
  issues_found?: number;
  issues_fixed?: number;
  verdict?: string | null;
  note?: string;
}

interface ProjectMeta {
  name?: string;
  description?: string;
  status?: string;
  tracks?: Record<string, string>;
}

interface ProjectData {
  project: string;
  name: string;
  description: string;
  tasks: Task[];
  lastModified: string;
  done: number;
  total: number;
  tracks: Record<string, string>;
}

export async function GET() {
  try {
    if (!fs.existsSync(MILESTONES_DIR)) {
      return NextResponse.json([]);
    }

    const results: ProjectData[] = [];

    for (const dir of fs.readdirSync(MILESTONES_DIR)) {
      const tasksPath = path.join(MILESTONES_DIR, dir, "tasks.json");
      if (!fs.existsSync(tasksPath)) continue;

      try {
        const raw = JSON.parse(fs.readFileSync(tasksPath, "utf-8"));
        const tasks: Task[] = [];

        if (Array.isArray(raw)) {
          for (const t of raw) tasks.push(normalize(t));
        } else if (Array.isArray(raw.tasks)) {
          for (const t of raw.tasks) tasks.push(normalize(t));
        } else if (Array.isArray(raw.dev)) {
          for (const t of [...raw.dev, ...(raw.ops || [])]) tasks.push(normalize(t));
        }

        if (tasks.length === 0) continue;

        let meta: ProjectMeta = {};
        const projectPath = path.join(MILESTONES_DIR, dir, "project.json");
        if (fs.existsSync(projectPath)) {
          meta = JSON.parse(fs.readFileSync(projectPath, "utf-8"));
        }

        const stat = fs.statSync(tasksPath);
        const done = tasks.filter((t) => t.status === "done" || t.status === "completed" || t.status === "fixed").length;

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
    return NextResponse.json(results);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

function normalize(t: any): Task {
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
