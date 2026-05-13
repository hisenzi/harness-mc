"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

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

interface Project {
  project: string;
  name: string;
  description: string;
  tasks: Task[];
  lastModified: string;
  done: number;
  total: number;
  tracks: Record<string, string>;
}

const trackMeta: Record<string, { icon: string; bg: string; text: string }> = {
  "formal-logic": { icon: "📐", bg: "bg-purple-500/15", text: "text-purple-400" },
  "cognitive-science": { icon: "🧠", bg: "bg-pink-500/15", text: "text-pink-400" },
  methodology: { icon: "⚙️", bg: "bg-orange-500/15", text: "text-orange-400" },
  dev: { icon: "🚀", bg: "bg-blue-500/15", text: "text-blue-400" },
  ops: { icon: "🔄", bg: "bg-yellow-500/15", text: "text-yellow-400" },
  planning: { icon: "📋", bg: "bg-green-500/15", text: "text-green-400" },
};

function statusIcon(s: string) {
  if (s === "done" || s === "completed" || s === "fixed") return "✅";
  if (s === "needs_fix") return "⚠️";
  if (s === "in_progress" || s === "validated") return "🔄";
  return "⬜";
}

function verdictBadge(v: string | null | undefined) {
  if (!v) return null;
  const colors: Record<string, string> = {
    "可用": "bg-green-500/20 text-green-400",
    "可用需修": "bg-yellow-500/20 text-yellow-400",
    "不建議用": "bg-red-500/20 text-red-400",
  };
  return (
    <span className={`text-caption px-1.5 py-0.5 rounded ${colors[v] || "bg-gray-500/20 text-gray-400"}`}>
      {v}
    </span>
  );
}

function foundationBadge(f: string | null | undefined) {
  if (!f) return null;
  const colors: Record<string, string> = {
    "極強": "text-green-400",
    "強": "text-blue-400",
    "中": "text-yellow-400",
    "弱": "text-red-400",
  };
  return <span className={`text-caption ${colors[f] || "text-gray-400"}`}>根據:{f}</span>;
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2 mt-2">
      <div className="flex-1 h-1.5 rounded-full bg-[var(--border)] overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{
            width: `${pct}%`,
            background: pct === 100 ? "#22c55e" : "var(--accent)",
          }}
        />
      </div>
      <span className="text-caption text-[var(--text-muted)]">
        {done}/{total}
      </span>
    </div>
  );
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<Project | null>(null);
  const [trackFilter, setTrackFilter] = useState("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/data/projects.json`)
      .then((r) => r.json())
      .then((data) => {
        setProjects(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const allTracks = [...new Set(projects.flatMap((p) => p.tasks.map((t) => t.track)))];
  const totalTasks = projects.reduce((s, p) => s + p.total, 0);
  const doneTasks = projects.reduce((s, p) => s + p.done, 0);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-[var(--text-muted)]">載入中...</p>
      </div>
    );
  }

  return (
    <main className="min-h-screen p-4 md:p-8 max-w-6xl mx-auto">
      <div className="mb-6">
        <div className="flex items-center gap-2">
          <Link href="/" className="text-[var(--text-muted)] hover:text-[var(--text)] text-body">
            ← MC
          </Link>
          <h1 className="text-title font-bold">專案</h1>
        </div>
        <p className="text-[var(--text-muted)] text-body mt-1">
          共 {projects.length} 個專案 · {doneTasks}/{totalTasks} tasks 完成
        </p>
        <div className="flex gap-1 bg-[var(--border)]/30 rounded-lg p-0.5 flex-wrap mt-4">
          {["all", ...allTracks].map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setTrackFilter(f)}
              className={`px-3 py-1.5 text-small font-medium rounded-md transition whitespace-nowrap ${
                trackFilter === f
                  ? "bg-[var(--accent)] text-white shadow-sm"
                  : "text-[var(--text-muted)] hover:text-[var(--text)]"
              }`}
            >
              {f === "all" ? "All" : `${(trackMeta[f] || { icon: "📋" }).icon} ${f}`}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {projects.map((proj) => {
          const filteredTasks =
            trackFilter === "all" ? proj.tasks : proj.tasks.filter((t) => t.track === trackFilter);
          if (filteredTasks.length === 0) return null;
          const filteredDone = filteredTasks.filter(
            (t) => t.status === "done" || t.status === "completed" || t.status === "fixed"
          ).length;

          return (
            <button
              key={proj.project}
              type="button"
              onClick={() => setSelected(proj)}
              className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 hover:border-[var(--accent)]/50 transition text-left cursor-pointer"
            >
              <div className="flex items-start justify-between mb-2">
                <span className="font-semibold text-heading">{proj.name}</span>
                <span className="text-caption text-[var(--text-muted)]">
                  {new Date(proj.lastModified).toISOString().slice(0, 10)}
                </span>
              </div>
              <p className="text-small text-[var(--text-muted)] line-clamp-2 mb-1">{proj.description}</p>
              <ProgressBar done={filteredDone} total={filteredTasks.length} />
              <div className="flex flex-wrap gap-1.5 mt-2">
                {[...new Set(filteredTasks.map((t) => t.track))].map((key) => {
                  const count = filteredTasks.filter((t) => t.track === key).length;
                  const m = trackMeta[key] || { icon: "📋", bg: "bg-gray-500/15", text: "text-gray-400" };
                  return (
                    <span key={key} className={`text-caption px-1.5 py-0.5 rounded ${m.bg} ${m.text}`}>
                      {m.icon} {count} {key}
                    </span>
                  );
                })}
              </div>
            </button>
          );
        })}
      </div>

      {selected && (
        <div className="fixed inset-0 z-50">
          <button type="button" className="absolute inset-0 bg-black/60" onClick={() => setSelected(null)} />
          <div className="absolute inset-4 md:inset-y-6 md:inset-x-auto md:w-full md:max-w-3xl md:left-1/2 md:-translate-x-1/2 rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-2xl flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-heading font-semibold truncate">{selected.name}</div>
                <div className="text-body text-[var(--text-muted)]">
                  {selected.done}/{selected.total} 完成
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-body hover:border-[var(--accent)] transition"
              >
                關閉
              </button>
            </div>

            <div className="flex-1 overflow-auto p-4">
              <ProgressBar done={selected.done} total={selected.total} />

              {(() => {
                const tracks = [...new Set(selected.tasks.map((t) => t.track))];
                return tracks.map((key) => {
                  const tasks = selected.tasks.filter((t) => t.track === key);
                  const doneCount = tasks.filter(
                    (t) => t.status === "done" || t.status === "completed" || t.status === "fixed"
                  ).length;
                  const m = trackMeta[key] || { icon: "📋", bg: "", text: "" };
                  return (
                    <div key={key} className="mt-4">
                      <div className="text-small text-[var(--text-muted)] font-medium mb-2">
                        {m.icon} {key} ({doneCount}/{tasks.length})
                      </div>
                      {tasks.map((task) => (
                        <div
                          key={task.id}
                          className="flex items-center gap-2 py-1.5 text-body flex-wrap"
                        >
                          <span>{statusIcon(task.status)}</span>
                          <span
                            className={
                              task.status === "done" || task.status === "completed" || task.status === "fixed"
                                ? "text-[var(--text-muted)] line-through"
                                : ""
                            }
                          >
                            {task.title}
                          </span>
                          {foundationBadge(task.foundation)}
                          {verdictBadge(task.verdict)}
                          {task.issues_found && task.issues_found > 0 ? (
                            <span className="text-caption text-[var(--text-muted)]">
                              問題:{task.issues_fixed}/{task.issues_found}
                            </span>
                          ) : null}
                          <span className="text-caption text-[var(--text-muted)] ml-auto">{task.id}</span>
                        </div>
                      ))}
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
