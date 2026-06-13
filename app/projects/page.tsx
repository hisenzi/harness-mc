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
  completed_at?: string | null;
  commits?: string[];
  summary?: string;
}

interface Project {
  project: string;
  name: string;
  description: string;
  status: string;
  type: string;
  priority: string;
  tasks: Task[];
  lastModified: string;
  done: number;
  total: number;
  tracks: Record<string, string>;
  decision_refs?: DecisionRef[];
}

interface DecisionRef {
  adr?: string;
  title: string;
  path: string;
  note?: string;
}

const trackMeta: Record<string, { bg: string; text: string }> = {
  "formal-logic": { bg: "bg-purple-500/15", text: "text-purple-400" },
  "cognitive-science": { bg: "bg-pink-500/15", text: "text-pink-400" },
  methodology: { bg: "bg-orange-500/15", text: "text-orange-400" },
  dev: { bg: "bg-blue-500/15", text: "text-blue-400" },
  ops: { bg: "bg-yellow-500/15", text: "text-yellow-400" },
  planning: { bg: "bg-green-500/15", text: "text-green-400" },
  "control-plane": { bg: "bg-cyan-500/15", text: "text-cyan-400" },
};

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    done: "bg-green-400",
    needs_fix: "bg-yellow-400",
    in_progress: "bg-blue-400",
    blocked: "bg-red-400",
    deferred: "bg-gray-500",
  };
  return (
    <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${colors[status] || "bg-gray-600"}`} />
  );
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

const catBarColor: Record<string, string> = {
  service: "#3b82f6",
  knowledge: "#a855f7",
  system: "#22c55e",
  learning: "#ec4899",
};

function ProgressBar({ done, total, type }: { done: number; total: number; type?: string }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const color = pct === 100 ? "#22c55e" : (type && catBarColor[type]) || "var(--accent)";
  return (
    <div className="flex items-center gap-2 mt-2">
      <div className="flex-1 h-1.5 rounded-full bg-[var(--border)] overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${pct}%`, background: color }}
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
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState("all");

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/data/projects.json`)
      .then((r) => r.json())
      .then((data) => {
        setProjects(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const totalTasks = projects.reduce((s, p) => s + p.total, 0);
  const doneTasks = projects.reduce((s, p) => s + p.done, 0);
  const types = [...new Set(projects.map((p) => p.type))].sort();
  const filtered =
    typeFilter === "all"
      ? projects
      : typeFilter === "completed"
        ? projects.filter((p) => p.status === "completed" || (p.done > 0 && p.done === p.total))
        : projects.filter((p) => p.type === typeFilter);
  const displayed = typeFilter === "completed" ? filtered : filtered.filter((p) => p.done < p.total);

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
        <div className="flex gap-1.5 mt-3">
          {["all", ...types, "completed"].map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTypeFilter(t)}
              className={`px-2.5 py-1 text-[12px] rounded-md transition ${
                typeFilter === t ? "text-white" : "text-[var(--text-muted)] hover:text-[var(--text)]"
              }`}
              style={{
                background: catBarColor[t]
                  ? typeFilter === t
                    ? `color-mix(in srgb, ${catBarColor[t]} 50%, black)`
                    : `color-mix(in srgb, ${catBarColor[t]} 25%, black)`
                  : typeFilter === t
                    ? "var(--accent)"
                    : "color-mix(in srgb, var(--border) 30%, transparent)",
              }}
            >
              {t === "all" ? `全部 ${projects.length}` : t}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3 mb-3">
        <div className="text-[13px] font-medium tracking-wide text-[var(--text)]">{typeFilter === "completed" ? "已完成" : "進行中"}</div>
        <div className="text-[11px] text-[var(--text-muted)]">{displayed.length} 專案</div>
        <div className="flex-1 border-t border-[var(--border)]"></div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {displayed.map((proj) => (
          <button
            key={proj.project}
            type="button"
            onClick={() => setSelected(proj)}
            className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 hover:border-[var(--accent)]/50 transition text-left cursor-pointer flex flex-col justify-start"
          >
            <div className="w-full">
              <span className="font-semibold text-body line-clamp-2 min-h-[52px] block">{proj.name}</span>
            </div>
            <div className="flex justify-between w-full text-caption text-[var(--text-muted)] mt-1">
              <span>{proj.type}</span>
              <span>{new Date(proj.lastModified).toLocaleDateString("zh-TW")}</span>
            </div>
            <p className="text-small text-[var(--text-muted)] line-clamp-2 mt-1.5 w-full">{proj.description}</p>
            <ProgressBar done={proj.done} total={proj.total} type={proj.type} />
            <div className="flex gap-2 mt-1.5 text-caption min-h-[20px]">
              {(() => {
                const blocked = proj.tasks.filter((t) => t.status === "blocked").length;
                const deferred = proj.tasks.filter((t) => t.status === "deferred").length;
                return (
                  <>
                    {blocked > 0 && <span className="text-red-400/80">{blocked} blocked</span>}
                    {deferred > 0 && <span className="text-[var(--text-muted)]">{deferred} deferred</span>}
                  </>
                );
              })()}
            </div>
          </button>
        ))}
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
              <ProgressBar done={selected.done} total={selected.total} type={selected.type} />

              {selected.decision_refs && selected.decision_refs.length > 0 && (
                <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--bg)]/50 p-3">
                  <div className="text-small font-medium text-[var(--text)] mb-2">關鍵決策</div>
                  <div className="space-y-2">
                    {selected.decision_refs.map((ref) => (
                      <div key={`${ref.adr || ref.title}-${ref.path}`} className="text-small">
                        <div className="flex flex-wrap items-baseline gap-2">
                          {ref.adr && (
                            <span className="text-caption px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-400">{ref.adr}</span>
                          )}
                          <span className="font-medium text-[var(--text)]">{ref.title}</span>
                        </div>
                        <div className="mt-0.5 font-mono text-caption text-[var(--text-muted)] break-all">{ref.path}</div>
                        {ref.note && <div className="mt-0.5 text-caption text-[var(--text-muted)]">{ref.note}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(() => {
                const tracks = [...new Set(selected.tasks.map((t) => t.track))];
                return tracks.map((key) => {
                  const tasks = selected.tasks.filter((t) => t.track === key);
                  const doneCount = tasks.filter(
                    (t) => t.status === "done" || t.status === "completed" || t.status === "fixed"
                  ).length;
                  const m = trackMeta[key] || { bg: "", text: "" };
                  const trackDescription = selected.tracks?.[key];
                  return (
                    <div key={key} className="mt-4">
                      <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <span className={`text-small font-medium px-1.5 py-0.5 rounded ${m.bg} ${m.text || "text-[var(--text-muted)]"}`}>
                          {key} ({doneCount}/{tasks.length})
                        </span>
                        {trackDescription && (
                          <span className="text-caption text-[var(--text-muted)]">{trackDescription}</span>
                        )}
                      </div>
                      {tasks.map((task) => {
                        const isDone = task.status === "done" || task.status === "completed" || task.status === "fixed";
                        const hasDetails = isDone && !!(task.summary || (task.commits && task.commits.length > 0));

                        const row = (
                          <div className="flex items-center gap-2 py-1.5 text-body flex-wrap min-w-0">
                            {hasDetails && (
                              <span className="text-[var(--text-muted)] text-caption transition-transform duration-150 group-open:rotate-90">▶</span>
                            )}
                            <StatusDot status={task.status} />
                            <span className={isDone ? "text-[var(--text-muted)] line-through" : ""}>
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
                        );

                        if (!hasDetails) return <div key={task.id}>{row}</div>;

                        return (
                          <details key={task.id} className="group">
                            <summary className="list-none cursor-pointer [&::-webkit-details-marker]:hidden">
                              {row}
                            </summary>
                            <div className="ml-7 mt-1 mb-2 pl-3 border-l-2 border-[var(--border)] text-small text-[var(--text-muted)] space-y-1">
                              {task.summary && <p>{task.summary}</p>}
                              <div className="flex items-center gap-3 flex-wrap">
                                {task.completed_at && (
                                  <span>{task.completed_at}</span>
                                )}
                                {task.commits && task.commits.length > 0 && (
                                  <span className="font-mono">
                                    {task.commits.map((c, i) => (
                                      <span key={c}>
                                        {i > 0 && " · "}
                                        <span className="text-[var(--accent)]">{c.slice(0, 7)}</span>
                                      </span>
                                    ))}
                                  </span>
                                )}
                              </div>
                            </div>
                          </details>
                        );
                      })}
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
