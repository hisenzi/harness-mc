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
  tasks: Task[];
}

const verdictConfig: Record<string, { label: string; icon: string; color: string; bg: string }> = {
  "可用": { label: "可用", icon: "✅", color: "text-green-400", bg: "bg-green-500/10" },
  "可用需修": { label: "可用需修", icon: "⚠️", color: "text-yellow-400", bg: "bg-yellow-500/10" },
  "不建議用": { label: "不建議用", icon: "❌", color: "text-red-400", bg: "bg-red-500/10" },
};

const foundationColors: Record<string, string> = {
  "極強": "text-green-400",
  "強": "text-blue-400",
  "中": "text-yellow-400",
  "弱": "text-red-400",
};

export default function EvaluationPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((data) => {
        setProjects(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const allTasks = projects.flatMap((p) => p.tasks);
  const validated = allTasks.filter((t) => t.verdict);
  const unvalidated = allTasks.filter((t) => !t.verdict);
  const issuesTotal = allTasks.reduce((s, t) => s + (t.issues_found || 0), 0);
  const issuesFixed = allTasks.reduce((s, t) => s + (t.issues_fixed || 0), 0);
  const issuesOpen = issuesTotal - issuesFixed;

  const byVerdict: Record<string, Task[]> = {};
  for (const t of validated) {
    const v = t.verdict!;
    if (!byVerdict[v]) byVerdict[v] = [];
    byVerdict[v].push(t);
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-[var(--text-muted)]">載入中...</p>
      </div>
    );
  }

  return (
    <main className="min-h-screen p-4 md:p-8 max-w-4xl mx-auto">
      <div className="mb-6">
        <div className="flex items-center gap-2">
          <Link href="/" className="text-[var(--text-muted)] hover:text-[var(--text)] text-sm">
            ← MC
          </Link>
          <h1 className="text-2xl font-bold">評估</h1>
        </div>
        <p className="text-[var(--text-muted)] text-sm mt-1">
          HC 驗證進度 · {validated.length}/{allTasks.length} 已驗
        </p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-center">
          <div className="text-2xl font-bold">{validated.length}<span className="text-sm font-normal text-[var(--text-muted)]">/{allTasks.length}</span></div>
          <div className="text-[11px] text-[var(--text-muted)] mt-1">已驗證</div>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-center">
          <div className="text-2xl font-bold text-green-400">{byVerdict["可用"]?.length || 0}</div>
          <div className="text-[11px] text-[var(--text-muted)] mt-1">✅ 可用</div>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-center">
          <div className="text-2xl font-bold text-yellow-400">{byVerdict["可用需修"]?.length || 0}</div>
          <div className="text-[11px] text-[var(--text-muted)] mt-1">⚠️ 可用需修</div>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-center">
          <div className={`text-2xl font-bold ${issuesOpen > 0 ? "text-yellow-400" : "text-[var(--text-muted)]"}`}>{issuesOpen}</div>
          <div className="text-[11px] text-[var(--text-muted)] mt-1">待修問題</div>
        </div>
      </div>

      {/* Validated — grouped by verdict */}
      {(["可用", "可用需修", "不建議用"] as const).map((verdict) => {
        const tasks = byVerdict[verdict];
        if (!tasks || tasks.length === 0) return null;
        const cfg = verdictConfig[verdict];
        return (
          <div key={verdict} className={`rounded-xl border border-[var(--border)] ${cfg.bg} p-4 mb-4`}>
            <div className={`text-sm font-semibold ${cfg.color} mb-3`}>
              {cfg.icon} {cfg.label} ({tasks.length})
            </div>
            <div className="space-y-2">
              {tasks.map((t) => (
                <div key={t.id} className="flex items-start gap-3 rounded-lg bg-[var(--card)] border border-[var(--border)] p-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium">{t.title}</div>
                    <div className="flex flex-wrap items-center gap-2 mt-1.5 text-[11px]">
                      <span className="text-[var(--text-muted)]">{t.id}</span>
                      <span className="text-[var(--text-muted)]">·</span>
                      <span className="text-[var(--text-muted)]">{t.track}</span>
                      {t.foundation && (
                        <>
                          <span className="text-[var(--text-muted)]">·</span>
                          <span className={foundationColors[t.foundation] || "text-gray-400"}>
                            根據：{t.foundation}
                          </span>
                        </>
                      )}
                    </div>
                    {t.note && (
                      <div className="text-[11px] text-[var(--text-muted)] mt-1.5 leading-relaxed">{t.note}</div>
                    )}
                  </div>
                  {(t.issues_found || 0) > 0 && (
                    <div className="text-right shrink-0">
                      <div className={`text-sm font-medium ${(t.issues_found! - (t.issues_fixed || 0)) > 0 ? "text-yellow-400" : "text-green-400"}`}>
                        {t.issues_fixed || 0}/{t.issues_found}
                      </div>
                      <div className="text-[10px] text-[var(--text-muted)]">已修/發現</div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {/* Unvalidated */}
      {unvalidated.length > 0 && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <div className="text-sm font-semibold text-[var(--text-muted)] mb-3">
            ⬜ 未驗證 ({unvalidated.length})
          </div>
          <div className="space-y-1">
            {unvalidated.map((t) => (
              <div key={t.id} className="flex items-center gap-2 py-1.5 text-[13px]">
                <span className="text-[var(--text-muted)]">⬜</span>
                <span>{t.title}</span>
                <span className="text-[10px] text-[var(--text-muted)] ml-auto">{t.track}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
