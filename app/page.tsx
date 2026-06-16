"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { StatusDot } from "./components/StatusDot";

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

interface SentinelEvent {
  type: string;
  project: string;
  projectName: string;
  taskId: string;
  title: string;
  from: string | null;
  to: string;
}

interface SentinelStale {
  project: string;
  projectName: string;
  daysSince: number;
  reasons: string[];
}

interface SentinelData {
  generated_at: string;
  baseline: { rev: string | null; time: string | null; since: string };
  brief: string;
  events: SentinelEvent[];
  stale: SentinelStale[];
  blocked_now: { project: string; projectName: string; taskId: string; title: string }[];
  error: string | null;
}

interface TaskEventPipelineData {
  generated_at: string;
  task_events: {
    pending: number;
    applied: number;
    rejected: number;
    rejected_by_reason: Record<string, number>;
  };
  sync_events: {
    pending: number;
    synced: number;
    failed: number;
    by_target: Record<string, { pending: number; synced: number; failed: number }>;
  };
  latest_reducer_run: {
    generated_at: string | null;
    applied: number;
    rejected: number;
    duplicates: number;
  } | null;
  recent_task_events: { id: string; queue: string; type: string; project: string; task_id: string; reason?: string }[];
  recent_sync_events: { id: string; queue: string; type: string; target: string; project: string; task_id: string }[];
}

// event type → StatusDot status（複用 MC 既有元件，跟 /projects 顏色語彙對齊）
const eventStatusMap: Record<string, string> = {
  done_added: "done",
  new_blocked: "blocked",
  unblocked: "in_progress",
  new_task: "deferred",
  status: "in_progress",
};

function SentinelCard() {
  const [data, setData] = useState<SentinelData | null>(null);

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/data/changes.json`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, []);

  if (!data || data.error) return null;

  const quiet = data.events.length === 0 && data.stale.length === 0;
  const shown = data.events.slice(0, 8);
  const rest = data.events.length - shown.length;
  const generatedLabel = new Date(data.generated_at).toLocaleString("zh-TW", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <div className="text-[13px] font-medium tracking-wide text-[var(--text)]">今日變化</div>
        <div className="text-[11px] text-[var(--text-muted)]">
          Sentinel · 基線 <span className="font-mono">{data.baseline.rev || "—"}</span> · {generatedLabel} 產生
        </div>
        <div className="flex-1 border-t border-[var(--border)]"></div>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
        {quiet ? (
          <div className="flex items-start gap-3">
            <span className="text-title leading-none opacity-40">◯</span>
            <div>
              <div className="text-body font-medium">持平</div>
              <div className="text-caption text-[var(--text-muted)] mt-1">
                基線 <span className="font-mono">{data.baseline.rev || "—"}</span> 至今無 task 變化 · 現存 {data.blocked_now.length} 筆 blocked 持平
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="text-body font-medium mb-3">{data.brief.replace(/^今日：/, "")}</div>

            {data.stale.length > 0 && (
              <div className="mb-3 space-y-1">
                {data.stale.map((s) => (
                  <div key={s.project} className="text-[12px] text-yellow-400">
                    ⚠ {s.projectName}：{s.reasons.join("；")}
                  </div>
                ))}
              </div>
            )}

            {shown.length > 0 && (
              <div className="space-y-1 text-[12px]">
                {shown.map((ev) => {
                  const status = eventStatusMap[ev.type] || "in_progress";
                  const dim = ev.type === "done_added" ? "opacity-60" : "";
                  return (
                    <Link
                      key={`${ev.project}-${ev.taskId}`}
                      href={`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/projects`}
                      className={`flex items-center gap-2 min-w-0 py-0.5 -mx-1 px-1 rounded hover:bg-[var(--border)]/40 transition ${dim}`}
                    >
                      <StatusDot status={status} />
                      <span className="text-[var(--text)] shrink-0">{ev.projectName}</span>
                      <span className="text-[var(--text-muted)] truncate">{ev.title}</span>
                      {ev.from && (
                        <span className="text-[11px] text-[var(--text-muted)] shrink-0 ml-auto">
                          {ev.from} → {ev.to}
                        </span>
                      )}
                    </Link>
                  );
                })}
                {rest > 0 && (
                  <div className="text-[11px] text-[var(--text-muted)] pl-4 pt-1">… 還有 {rest} 筆</div>
                )}
              </div>
            )}

            <div className="mt-3 pt-3 border-t border-[var(--border)] flex items-center justify-between text-caption text-[var(--text-muted)]">
              <span>現存 {data.blocked_now.length} 筆 blocked</span>
              <Link href={`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/projects`} className="hover:text-[var(--accent)] transition">
                查看所有專案 →
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function TaskEventPipelineCard() {
  const [data, setData] = useState<TaskEventPipelineData | null>(null);

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/data/task-events.json`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, []);

  if (!data) return null;

  const hasPressure = data.task_events.pending > 0 || data.task_events.rejected > 0 || data.sync_events.pending > 0 || data.sync_events.failed > 0;
  const latest = data.latest_reducer_run;
  const rejectedReasons = Object.entries(data.task_events.rejected_by_reason);
  const watchList = [
    ...data.recent_task_events.filter((event) => event.queue === "pending" || event.queue === "rejected").slice(0, 3),
    ...data.recent_sync_events.filter((event) => event.queue === "pending" || event.queue === "failed").slice(0, 3),
  ].slice(0, 5);

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <div className="text-[13px] font-medium tracking-wide text-[var(--text)]">Task Event Pipeline</div>
        <div className="text-[11px] text-[var(--text-muted)]">single-writer queue health</div>
        <div className="flex-1 border-t border-[var(--border)]"></div>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <div className="text-[11px] text-[var(--text-muted)]">Task pending</div>
            <div className={data.task_events.pending > 0 ? "text-[20px] font-semibold text-yellow-400" : "text-[20px] font-semibold text-[var(--text)]"}>
              {data.task_events.pending}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-[var(--text-muted)]">Rejected</div>
            <div className={data.task_events.rejected > 0 ? "text-[20px] font-semibold text-red-400" : "text-[20px] font-semibold text-[var(--text)]"}>
              {data.task_events.rejected}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-[var(--text-muted)]">Sync pending</div>
            <div className={data.sync_events.pending > 0 ? "text-[20px] font-semibold text-blue-400" : "text-[20px] font-semibold text-[var(--text)]"}>
              {data.sync_events.pending}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-[var(--text-muted)]">Sync failed</div>
            <div className={data.sync_events.failed > 0 ? "text-[20px] font-semibold text-red-400" : "text-[20px] font-semibold text-[var(--text)]"}>
              {data.sync_events.failed}
            </div>
          </div>
          <div className="ml-auto text-right text-[11px] text-[var(--text-muted)]">
            {latest ? (
              <>
                <div>latest reducer</div>
                <div>{latest.applied} applied · {latest.rejected} rejected · {latest.duplicates} duplicate</div>
              </>
            ) : (
              <div>no reducer report</div>
            )}
          </div>
        </div>

        <div className="mt-4 pt-3 border-t border-[var(--border)]">
          {hasPressure ? (
            <div className="space-y-1 text-[12px]">
              {watchList.map((event) => (
                <div key={`${event.queue}-${event.id}`} className="flex items-center gap-2 min-w-0">
                  <StatusDot status={event.queue === "rejected" || event.queue === "failed" ? "blocked" : "in_progress"} />
                  <span className="text-[var(--text)] shrink-0">{event.queue}</span>
                  <span className="text-[var(--text-muted)] truncate">
                    {"target" in event ? event.target : event.type} · {event.project}/{event.task_id}
                  </span>
                  {"reason" in event && event.reason && <span className="ml-auto text-[11px] text-red-300 shrink-0">{event.reason}</span>}
                </div>
              ))}
              {rejectedReasons.length > 0 && (
                <div className="pt-2 text-[11px] text-[var(--text-muted)]">
                  rejected reasons: {rejectedReasons.map(([reason, count]) => `${reason} ${count}`).join(" · ")}
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-[12px] text-[var(--text-muted)]">
              <StatusDot status="completed" />
              <span>queues clear</span>
              <span className="ml-auto">{data.task_events.applied} applied · {data.sync_events.synced} synced</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
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
        <SentinelCard />
        <TaskEventPipelineCard />

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
