"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Task {
  id: string;
  status: string;
  verdict?: string | null;
  foundation?: string | null;
  issues_found?: number;
  issues_fixed?: number;
}

interface LearningSummary {
  total: number;
  now: number;
  next: number;
  someday: number;
  done: number;
  byType: Record<string, number>;
}

interface Project {
  project: string;
  name: string;
  tasks: Task[];
  done: number;
  total: number;
}

function LearningCard() {
  const [data, setData] = useState<LearningSummary | null>(null);

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/data/learning.json`)
      .then((r) => r.json())
      .then((d) => setData(d.summary))
      .catch(() => {});
  }, []);

  if (!data) return <div className="text-body text-[var(--text-muted)] mt-3">載入中...</div>;

  const typeLabels: Record<string, string> = { course: "課程", book: "書", free: "免費", yt: "YT" };

  return (
    <>
      <div className="flex items-baseline gap-3 mt-3">
        <span className="text-[20px] font-semibold text-[var(--text)]">{data.total}</span>
        <span className="text-[12px] text-[var(--text-muted)]">學習項目</span>
      </div>
      <div className="flex gap-3 mt-2 text-[12px]">
        {data.now > 0 && <span className="text-pink-400">NOW {data.now}</span>}
        {data.next > 0 && <span className="text-blue-400">NEXT {data.next}</span>}
        {data.done > 0 && <span className="text-green-400">DONE {data.done}</span>}
        {data.someday > 0 && <span className="text-[var(--text-muted)]">SOMEDAY {data.someday}</span>}
      </div>
      <div className="flex flex-wrap gap-2 mt-3 text-[11px] text-[var(--text-muted)]">
        {Object.entries(data.byType).map(([k, v]) => (
          <span key={k}>{typeLabels[k] || k} {v}</span>
        ))}
      </div>
    </>
  );
}

function ToolsCard() {
  const [summary, setSummary] = useState<{ totalSkills: number; totalScripts: number; totalHooks: number } | null>(null);

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/data/tools.json`)
      .then((r) => r.json())
      .then((d) => setSummary(d.summary))
      .catch(() => {});
  }, []);

  if (!summary) return <div className="text-body text-[var(--text-muted)] mt-3">載入中...</div>;

  return (
    <div className="text-body text-[var(--text-muted)] mt-3">
      {summary.totalSkills} skills · {summary.totalScripts} scripts · {summary.totalHooks} hooks
    </div>
  );
}

function EvaluationCard({ projects }: { projects: Project[] }) {
  const allTasks = projects.flatMap((p) => p.tasks);
  const validated = allTasks.filter((t) => t.verdict);
  const total = allTasks.length;

  const verdictCounts = {
    ok: validated.filter((t) => t.verdict === "可用").length,
    fix: validated.filter((t) => t.verdict === "可用需修").length,
    bad: validated.filter((t) => t.verdict === "不建議用").length,
  };

  const issuesTotal = allTasks.reduce((s, t) => s + (t.issues_found || 0), 0);
  const issuesFixed = allTasks.reduce((s, t) => s + (t.issues_fixed || 0), 0);
  const issuesOpen = issuesTotal - issuesFixed;

  const foundations: Record<string, number> = {};
  for (const t of validated) {
    if (t.foundation) foundations[t.foundation] = (foundations[t.foundation] || 0) + 1;
  }

  return (
    <Link
      href="/evaluation"
      className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 hover:border-[var(--accent)]/50 transition cursor-pointer"
    >
      <div className="flex items-center gap-3 mb-3">
        <span className="text-title">🔍</span>
        <div>
          <div className="font-semibold text-heading">評估</div>
          <div className="text-[11px] text-[var(--text-muted)]">Evaluation</div>
        </div>
      </div>

      <div className="text-caption text-[var(--text-muted)] mb-3">
        HC 驗證 {validated.length}/{total} 已驗
      </div>

      <div className="space-y-1 text-[12px]">
        <div className="flex items-center gap-2">
          <span className="w-3 text-center">✅</span>
          <span className="text-[var(--text-muted)]">可用</span>
          <span className="ml-auto">{verdictCounts.ok}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 text-center">⚠️</span>
          <span className="text-[var(--text-muted)]">可用需修</span>
          <span className="ml-auto">{verdictCounts.fix}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 text-center">❌</span>
          <span className="text-[var(--text-muted)]">不建議用</span>
          <span className="ml-auto">{verdictCounts.bad}</span>
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-[var(--border)] flex items-center justify-between text-[11px] text-[var(--text-muted)]">
        <span>待修問題 <span className={issuesOpen > 0 ? "text-yellow-400" : ""}>{issuesOpen}</span></span>
        <span>
          根據{" "}
          {Object.entries(foundations)
            .map(([k, v]) => `${k} ${v}`)
            .join(" · ") || "—"}
        </span>
      </div>
    </Link>
  );
}

export default function HomePage() {
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/data/projects.json`)
      .then((r) => r.json())
      .then(setProjects)
      .catch(() => {});
  }, []);

  const totalTasks = projects.reduce((s, p) => s + p.total, 0);
  const doneTasks = projects.reduce((s, p) => s + p.done, 0);

  return (
    <main className="min-h-screen p-6 md:p-10 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-title font-bold">Mission Control</h1>
        <p className="text-body text-[var(--text-muted)] mt-1">
          Harness Engineering 四大支柱 · 雙層架構
        </p>
      </div>

      <div className="space-y-6">
        <div>
          <div className="flex items-center gap-3 mb-3">
            <div className="text-[13px] font-medium tracking-wide text-[var(--text)]">紀律層</div>
            <div className="text-[11px] text-[var(--text-muted)]">Execution Discipline — 每次執行都過的關卡</div>
            <div className="flex-1 border-t border-[var(--border)]"></div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 規劃與執行 */}
        <Link
          href="/projects"
          className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 hover:border-[var(--accent)]/50 transition cursor-pointer"
        >
          <div className="flex items-center gap-3 mb-2">
            <span className="text-title">📋</span>
            <div>
              <div className="font-semibold text-heading">規劃與執行</div>
              <div className="text-[11px] text-[var(--text-muted)]">Planning & Execution</div>
            </div>
          </div>
          <div className="text-body text-[var(--text-muted)] mt-3">
            {projects.length} 專案 · {doneTasks}/{totalTasks} 完成
          </div>
        </Link>

        {/* 評估 */}
        <EvaluationCard projects={projects} />
          </div>
        </div>

        <div>
          <div className="flex items-center gap-3 mb-3">
            <div className="text-[13px] font-medium tracking-wide text-[var(--text)]">能力層</div>
            <div className="text-[11px] text-[var(--text-muted)]">Capability Platform — 設定一次，持續存在</div>
            <div className="flex-1 border-t border-[var(--border)]"></div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 記憶 */}
        <div className="rounded-xl border border-[var(--border)]/50 bg-[var(--card)] p-5 opacity-40">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-title">🧠</span>
            <div>
              <div className="font-semibold text-heading">記憶</div>
              <div className="text-[11px] text-[var(--text-muted)]">Memory</div>
            </div>
          </div>
          <div className="text-body text-[var(--text-muted)] mt-3">Phase 2</div>
        </div>

        {/* 工具 */}
        <Link
          href="/tools"
          className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 hover:border-[var(--accent)]/50 transition cursor-pointer"
        >
          <div className="flex items-center gap-3 mb-2">
            <span className="text-title">🔧</span>
            <div>
              <div className="font-semibold text-heading">工具</div>
              <div className="text-[11px] text-[var(--text-muted)]">Tool Use</div>
            </div>
          </div>
          <ToolsCard />
        </Link>
          </div>
        </div>

        <div>
          <div className="flex items-center gap-3 mb-3">
            <div className="text-[13px] font-medium tracking-wide text-[var(--text)]">學習層</div>
            <div className="text-[11px] text-[var(--text-muted)]">Learning Pipeline — 多課程自學管線</div>
            <div className="flex-1 border-t border-[var(--border)]"></div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Link
              href="/learning"
              className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 hover:border-pink-500/50 transition cursor-pointer"
            >
              <div className="flex items-center gap-3 mb-2">
                <span className="text-title">📚</span>
                <div>
                  <div className="font-semibold text-heading">學習進度</div>
                  <div className="text-[11px] text-[var(--text-muted)]">Course Tracker</div>
                </div>
              </div>
              <LearningCard />
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
