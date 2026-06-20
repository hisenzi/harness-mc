"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { StatusDot } from "./components/StatusDot";

interface Task {
  id: string;
  title?: string;
  status: string;
  track?: string;
  order?: number | null;
  order_label?: string;
  verdict?: string | null;
  foundation?: string | null;
  issues_found?: number;
  issues_fixed?: number;
  done_condition?: string;
  completed_at?: string | null;
  summary?: string;
  external_refs?: {
    heptabase?: {
      whiteboard?: string;
      whiteboard_id?: string;
      card_id?: string;
      synced_at?: string;
      sync_mode?: string;
    };
  };
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

interface WorktreeRepo {
  repo: string;
  path_label: string;
  branch: string;
  upstream: string | null;
  head: string | null;
  is_detached: boolean;
  staged_count: number;
  unstaged_count: number;
  untracked_count: number;
  local_commits_count: number;
  remote_commits_count: number;
  status: "uncommitted" | "local_commits" | "needs_reconcile" | "clean";
  risk: "low" | "medium" | "high";
  suggested_action: string;
  files: { indexStatus: string; worktreeStatus: string; path: string }[];
}

interface WorktreeStatusData {
  generated_at: string;
  summary: {
    scanned: number;
    uncommitted: number;
    local_commits: number;
    needs_reconcile: number;
    clean: number;
  };
  repositories: WorktreeRepo[];
}

interface VisualSyncTask extends Task {
  project: string;
  projectName: string;
}

function MorroWiseSurfaceCard({ projects }: { projects: Project[] }) {
  const [sentinel, setSentinel] = useState<SentinelData | null>(null);
  const [pipeline, setPipeline] = useState<TaskEventPipelineData | null>(null);

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/data/changes.json`)
      .then((r) => r.json())
      .then(setSentinel)
      .catch(() => {});

    fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/data/task-events.json`)
      .then((r) => r.json())
      .then(setPipeline)
      .catch(() => {});
  }, []);

  const harness = projects.find((project) => project.project === "harness-mc");
  const morrowiseTasks = (harness?.tasks || [])
    .filter((task) => task.track === "morrowise-system" || task.id.startsWith("morrowise-"))
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || a.id.localeCompare(b.id));
  const completed = morrowiseTasks.filter((task) => isDoneStatus(task.status));
  const openTasks = morrowiseTasks.filter((task) => !isDoneStatus(task.status) && task.status !== "deferred" && task.status !== "archived");
  const blockedTasks = morrowiseTasks.filter((task) => task.status === "blocked");
  const nextTask = openTasks[0] || null;
  const pendingEvents = (pipeline?.task_events.pending || 0) + (pipeline?.sync_events.pending || 0);
  const staleMorroWise = (sentinel?.stale || []).filter((item) => item.project === "harness-mc").length;
  const generatedAt = latestDate([sentinel?.generated_at, pipeline?.generated_at]);
  const generatedLabel = generatedAt
    ? generatedAt.toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "讀取中";
  const surfaceStatus = blockedTasks.length > 0 || pendingEvents > 0 ? "needs_fix" : nextTask ? "in_progress" : "completed";
  const openLoopCount = openTasks.length + pendingEvents + staleMorroWise;
  const triggerRows = [
    { label: "User phrase", signal: "MorroWise / 活系統 / system-ops", state: nextTask ? "routes to task" : "quiet" },
    { label: "Weekly review", signal: `${sentinel?.brief || "waiting for sentinel"}`, state: staleMorroWise > 0 ? `${staleMorroWise} stale` : "fresh" },
    { label: "Stale / blocked", signal: `${blockedTasks.length} blocked · ${openTasks.length} open`, state: blockedTasks.length > 0 ? "needs owner" : "tracked" },
    { label: "New project gate", signal: "requires project/task anchor", state: "schema guarded" },
  ];
  const openLoopRows = [
    ...openTasks.slice(0, 3).map((task) => ({
      id: task.id,
      label: task.order_label || task.id,
      text: task.title || task.id,
      tone: task.status === "blocked" ? "red" : "yellow",
    })),
    ...(pendingEvents > 0
      ? [{ id: "task-event-pending", label: "events", text: `${pendingEvents} pending task/sync events`, tone: "blue" }]
      : []),
  ].slice(0, 4);

  if (!harness || morrowiseTasks.length === 0) return null;

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <div className="text-[13px] font-medium tracking-wide text-[var(--text)]">MorroWise 活系統</div>
        <div className="text-[11px] text-[var(--text-muted)]">
          growth layer · generated {generatedLabel} · source projects/task-events/changes
        </div>
        <div className="flex-1 border-t border-[var(--border)]"></div>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
        <div className="grid grid-cols-1 xl:grid-cols-[0.95fr_1.2fr_1fr] gap-4">
          <div className="rounded-lg border border-[var(--border)] p-4 min-w-0">
            <div className="flex items-center gap-2 pb-3 mb-3 border-b border-[var(--border)]">
              <StatusDot status={surfaceStatus} />
              <span className="text-[12px] font-semibold text-[var(--text-muted)]">Living-system state</span>
              <span className="ml-auto font-mono text-[11px] text-[var(--text-muted)]">{completed.length}/{morrowiseTasks.length}</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <MorroWiseMetric label="done" value={String(completed.length)} tone="green" />
              <MorroWiseMetric label="open loops" value={String(openLoopCount)} tone={openLoopCount > 0 ? "yellow" : "green"} />
              <MorroWiseMetric label="pending" value={String(pendingEvents)} tone={pendingEvents > 0 ? "blue" : "green"} />
            </div>
            <div className="mt-4 pt-3 border-t border-[var(--border)] min-w-0">
              <div className="text-[11px] text-[var(--text-muted)]">Next executable task</div>
              {nextTask ? (
                <div className="mt-1 min-w-0">
                  <div className="font-mono text-[12px] text-[var(--text)] truncate">{nextTask.order_label || nextTask.id}</div>
                  <div className="mt-1 text-[12px] text-[var(--text-muted)] line-clamp-2">{nextTask.title || nextTask.id}</div>
                </div>
              ) : (
                <div className="mt-1 text-[12px] text-green-400">MorroWise first control-console loop complete</div>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-[var(--border)] p-4 min-w-0">
            <div className="pb-3 mb-3 border-b border-[var(--border)] text-[12px] font-semibold text-[var(--text-muted)]">
              Trigger sources
            </div>
            <div className="space-y-2">
              {triggerRows.map((row) => (
                <div key={row.label} className="grid grid-cols-[104px_1fr_auto] gap-3 items-baseline min-w-0 text-[12px]">
                  <span className="font-semibold text-[var(--text)] truncate">{row.label}</span>
                  <span className="text-[var(--text-muted)] truncate">{row.signal}</span>
                  <span className="rounded-full border border-[var(--border)] px-2 py-0.5 font-mono text-[10px] text-[var(--text-muted)]">{row.state}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 pt-3 border-t border-[var(--border)] text-[11px] leading-relaxed text-[var(--text-muted)]">
              Surface reads current MC data; future `morrowise-system.json` can replace this derived view without changing the dashboard contract.
            </div>
          </div>

          <div className="rounded-lg border border-[var(--border)] p-4 min-w-0">
            <div className="pb-3 mb-3 border-b border-[var(--border)] text-[12px] font-semibold text-[var(--text-muted)]">
              Feedback / open loops
            </div>
            <div className="space-y-2">
              {openLoopRows.length > 0 ? (
                openLoopRows.map((row) => (
                  <div key={row.id} className="min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <StatusDot status={row.tone === "red" ? "blocked" : row.tone === "blue" ? "in_progress" : "needs_fix"} />
                      <span className="font-mono text-[11px] text-[var(--text)] truncate">{row.label}</span>
                      <span className={morroWiseLoopTagClass(row.tone)}>{row.tone}</span>
                    </div>
                    <div className="mt-0.5 pl-4 text-[11px] text-[var(--text-muted)] truncate">{row.text}</div>
                  </div>
                ))
              ) : (
                <div className="text-[12px] text-[var(--text-muted)]">目前沒有 dashboard-visible open loop</div>
              )}
            </div>
            <div className="mt-4 pt-3 border-t border-[var(--border)] text-[11px] text-[var(--text-muted)]">
              canonical state: <span className="font-mono text-[var(--text)]">milestones/harness-mc/tasks.json</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MorroWiseMetric({ label, value, tone }: { label: string; value: string; tone: "green" | "yellow" | "blue" }) {
  const color = tone === "green" ? "text-green-400" : tone === "yellow" ? "text-yellow-400" : "text-blue-400";
  return (
    <div className="rounded-md border border-[var(--border)] bg-white/[0.018] p-2 min-w-0">
      <div className="text-[10px] text-[var(--text-muted)] truncate">{label}</div>
      <div className={`mt-1 font-mono text-[20px] leading-none font-semibold ${color}`}>{value}</div>
    </div>
  );
}

function morroWiseLoopTagClass(tone: string) {
  const base = "ml-auto shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-mono";
  if (tone === "red") return `${base} border-red-400/30 text-red-400`;
  if (tone === "blue") return `${base} border-blue-400/30 text-blue-400`;
  return `${base} border-yellow-400/30 text-yellow-400`;
}

function isDoneStatus(status: string) {
  return status === "completed" || status === "done" || status === "fixed";
}

function SystemAttentionCard() {
  const [sentinel, setSentinel] = useState<SentinelData | null>(null);
  const [pipeline, setPipeline] = useState<TaskEventPipelineData | null>(null);

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/data/changes.json`)
      .then((r) => r.json())
      .then(setSentinel)
      .catch(() => {});

    fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/data/task-events.json`)
      .then((r) => r.json())
      .then(setPipeline)
      .catch(() => {});
  }, []);

  const generatedAt = latestDate([sentinel?.generated_at, pipeline?.generated_at]);
  const generatedLabel = generatedAt
    ? generatedAt.toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "讀取中";
  const freshnessMinutes = generatedAt ? Math.max(0, Math.round((Date.now() - generatedAt.getTime()) / 60000)) : null;
  const freshnessOk = freshnessMinutes !== null && freshnessMinutes <= 15;
  const pendingQueue = (pipeline?.task_events.pending || 0) + (pipeline?.sync_events.pending || 0);
  const staleCount = sentinel?.stale.length || 0;
  const blockedCount = sentinel?.blocked_now.length || 0;
  const topItems = buildAttentionItems(sentinel).slice(0, 3);

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <div className="text-[13px] font-medium tracking-wide text-[var(--text)]">System Attention</div>
        <div className="text-[11px] text-[var(--text-muted)]">
          generated {generatedLabel} · freshness {freshnessOk ? "OK" : "CHECK"} · auto every build / LaunchAgent
        </div>
        <div className="flex-1 border-t border-[var(--border)]"></div>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
        <div className="grid grid-cols-1 xl:grid-cols-[0.8fr_1.4fr_1fr] gap-4">
          <div className="grid grid-cols-2 gap-3">
            <AttentionMetric name="stale" value={String(staleCount)} hint="需要重新判斷" tone="yellow" />
            <AttentionMetric name="blocked" value={String(blockedCount)} hint="現存卡住" tone="red" />
            <AttentionMetric name="queue pending" value={String(pendingQueue)} hint="待 reducer 處理" tone="blue" />
            <AttentionMetric
              name="freshness"
              value={freshnessOk ? "OK" : "CHECK"}
              hint={freshnessMinutes === null ? "讀取中" : `${freshnessMinutes} 分鐘前更新`}
              tone={freshnessOk ? "green" : "yellow"}
            />
          </div>

          <div className="rounded-lg border border-[var(--border)] p-4 min-w-0">
            <div className="flex items-center gap-2 pb-3 mb-3 border-b border-[var(--border)] text-[12px] font-semibold text-[var(--text-muted)]">
              <StatusDot status={pendingQueue > 0 || staleCount > 0 || blockedCount > 0 ? "needs_fix" : "completed"} />
              <span>Top attention items</span>
            </div>
            <div className="space-y-2">
              {topItems.length > 0 ? (
                topItems.map((item) => (
                  <div key={`${item.project}-${item.taskId}-${item.kind}`} className="grid grid-cols-[104px_1fr_auto] gap-3 items-baseline min-w-0 text-[12px]">
                    <span className="font-semibold text-[var(--text)] truncate">{item.projectName}</span>
                    <span className="text-[var(--text-muted)] truncate">{item.description}</span>
                    <span className={attentionPillClass(item.kind)}>{item.kind}</span>
                  </div>
                ))
              ) : (
                <div className="text-[12px] text-[var(--text-muted)]">目前沒有需要立即處理的項目</div>
              )}
            </div>
            <div className="mt-4 pt-3 border-t border-[var(--border)] flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--text-muted)]">
              <span>today done <span className="font-mono text-[var(--text)]">{countEvents(sentinel, "done_added", "+")}</span></span>
              <span>new tasks <span className="font-mono text-[var(--text)]">{countEvents(sentinel, "new_task", "+")}</span></span>
              <span>baseline <span className="font-mono text-[var(--text)]">{sentinel?.baseline.rev || "—"}</span></span>
              <span>details moved to project drill-down</span>
            </div>
          </div>

          <div className="rounded-lg border border-[var(--border)] p-4 min-w-0">
            <div className="flex items-center gap-2 pb-3 mb-3 border-b border-[var(--border)] text-[12px] font-semibold text-[var(--text-muted)]">
              <StatusDot status={freshnessOk ? "completed" : "needs_fix"} />
              <span>Data freshness</span>
            </div>
            <div className="space-y-2 text-[12px]">
              <FreshnessRow source="sentinel" path="public/data/changes.json" generatedAt={sentinel?.generated_at} />
              <FreshnessRow source="queue" path="public/data/task-events.json" generatedAt={pipeline?.generated_at} />
              <FreshnessRow source="projects" path="public/data/projects.json" generatedAt={sentinel?.generated_at} />
            </div>
            <div className="mt-4 pt-3 border-t border-[var(--border)] text-[11px] leading-relaxed text-[var(--text-muted)]">
              Auto refresh contract：本地 source 有新增或變更時自動重建 read model；外部 source 只顯示 last checked，不宣稱 live。
            </div>
          </div>
        </div>
      </div>
      <div className="mt-2 text-[12px] text-[var(--text-muted)]">
        首頁只回答「現在要不要管、管哪裡、資料新不新」；大量 delta log 移到專案 drill-down。
      </div>
    </div>
  );
}

function AttentionMetric({ name, value, hint, tone }: { name: string; value: string; hint: string; tone: "yellow" | "red" | "blue" | "green" }) {
  const color = tone === "yellow" ? "text-yellow-400" : tone === "red" ? "text-red-400" : tone === "blue" ? "text-blue-400" : "text-green-400";
  return (
    <div className="min-h-[74px] rounded-lg border border-[var(--border)] bg-white/[0.018] p-3">
      <div className="text-[11px] text-[var(--text-muted)]">{name}</div>
      <div className={`mt-1 font-mono text-[24px] leading-none font-bold ${color}`}>{value}</div>
      <div className="mt-1 text-[11px] text-[var(--text-muted)]">{hint}</div>
    </div>
  );
}

function FreshnessRow({ source, path, generatedAt }: { source: string; path: string; generatedAt?: string }) {
  const date = generatedAt ? new Date(generatedAt) : null;
  const minutes = date ? Math.max(0, Math.round((Date.now() - date.getTime()) / 60000)) : null;
  const ok = minutes !== null && minutes <= 15;
  return (
    <div className="grid grid-cols-[72px_1fr_auto] gap-2 items-baseline min-w-0 text-[12px]">
      <span className="font-semibold text-[var(--text)]">{source}</span>
      <span className="truncate text-[var(--text-muted)]">{path}</span>
      <span className={`font-mono ${ok ? "text-green-400" : "text-yellow-400"}`}>{minutes === null ? "—" : `${minutes}m`}</span>
    </div>
  );
}

function latestDate(values: (string | undefined)[]) {
  const dates = values.filter(Boolean).map((value) => new Date(value as string)).filter((date) => !Number.isNaN(date.getTime()));
  if (dates.length === 0) return null;
  return new Date(Math.max(...dates.map((date) => date.getTime())));
}

function countEvents(data: SentinelData | null, type: string, prefix = "") {
  const count = data?.events.filter((event) => event.type === type).length || 0;
  return `${prefix}${count}`;
}

function buildAttentionItems(data: SentinelData | null) {
  if (!data) return [];
  const stale = data.stale.map((item) => ({
    kind: "stale",
    project: item.project,
    projectName: item.projectName,
    taskId: item.project,
    description: item.reasons.join("；"),
  }));
  const blocked = data.blocked_now.map((item) => ({
    kind: "blocked",
    project: item.project,
    projectName: item.projectName,
    taskId: item.taskId,
    description: item.title,
  }));
  return [...stale, ...blocked];
}

function attentionPillClass(kind: string) {
  const color = kind === "blocked" ? "border-red-400/40 text-red-400" : "border-yellow-400/40 text-yellow-400";
  return `rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold ${color}`;
}

const worktreeStatusLabel: Record<WorktreeRepo["status"], string> = {
  uncommitted: "未提交變更",
  local_commits: "本機未推送",
  needs_reconcile: "需要對帳",
  clean: "全部收乾淨",
};

const worktreeDotStatus: Record<WorktreeRepo["status"], string> = {
  uncommitted: "needs_fix",
  local_commits: "in_progress",
  needs_reconcile: "blocked",
  clean: "completed",
};

function WorktreeStatusCard() {
  const [data, setData] = useState<WorktreeStatusData | null>(null);

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/data/worktrees.json`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, []);

  if (!data) return null;

  const quiet = data.repositories.every((repo) => repo.status === "clean");
  const groupedRepos = {
    uncommitted: data.repositories.filter((repo) => repo.status === "uncommitted"),
    local_commits: data.repositories.filter((repo) => repo.status === "local_commits"),
    needs_reconcile: data.repositories.filter((repo) => repo.status === "needs_reconcile"),
  };
  const generatedLabel = new Date(data.generated_at).toLocaleString("zh-TW", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <div className="text-[13px] font-medium tracking-wide text-[var(--text)]">待收尾工作</div>
        <div className="text-[11px] text-[var(--text-muted)]">
          Worktree Status · {data.summary.scanned} 個倉庫已掃描 · {generatedLabel} 產生
        </div>
        <div className="flex-1 border-t border-[var(--border)]"></div>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
        {quiet ? (
          <div className="flex items-center gap-2 text-[12px] text-[var(--text-muted)]">
            <StatusDot status="completed" />
            <span>全部收乾淨 — 無未提交變更、本機未推送或待對帳項目</span>
            <span className="ml-auto">{data.summary.scanned} 個倉庫已掃描</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <WorktreeStatusColumn status="uncommitted" repos={groupedRepos.uncommitted} count={data.summary.uncommitted} tone="yellow" />
            <WorktreeStatusColumn status="local_commits" repos={groupedRepos.local_commits} count={data.summary.local_commits} tone="blue" />
            <WorktreeStatusColumn status="needs_reconcile" repos={groupedRepos.needs_reconcile} count={data.summary.needs_reconcile} tone="red" />
          </div>
        )}
      </div>
    </div>
  );
}

function WorktreeStatusColumn({
  status,
  repos,
  count,
  tone,
}: {
  status: WorktreeRepo["status"];
  repos: WorktreeRepo[];
  count: number;
  tone: "yellow" | "blue" | "red";
}) {
  const toneClass =
    tone === "yellow"
      ? "border-yellow-400/20 bg-yellow-400/5 text-yellow-400"
      : tone === "blue"
        ? "border-blue-400/20 bg-blue-400/5 text-blue-400"
        : "border-red-400/20 bg-red-400/5 text-red-400";

  return (
    <div className={`rounded-lg border p-4 min-w-0 ${toneClass}`}>
      <div className="flex items-center gap-2 pb-3 border-b border-current/15">
        <StatusDot status={worktreeDotStatus[status]} />
        <span className="text-[12px] font-semibold">{worktreeStatusLabel[status]}</span>
        <span className="ml-auto text-[22px] leading-none font-semibold">{count}</span>
      </div>

      <div className="mt-3 space-y-2">
        {repos.length > 0 ? (
          repos.slice(0, 5).map((repo) => {
            const dirtyCount = repo.staged_count + repo.unstaged_count + repo.untracked_count;
            return (
              <div key={`${repo.path_label}-${repo.status}`} className="rounded-md border border-[var(--border)] bg-[var(--card)]/80 px-3 py-2 text-[12px] text-[var(--text)]">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-semibold truncate">{repo.repo}</span>
                  <span className="ml-auto shrink-0 font-mono text-[11px] text-[var(--text-muted)]">
                    {dirtyCount > 0 && `${dirtyCount} 變更`}
                    {dirtyCount > 0 && repo.local_commits_count > 0 && " · "}
                    {repo.local_commits_count > 0 && `↑${repo.local_commits_count}`}
                    {repo.remote_commits_count > 0 && ` ↓${repo.remote_commits_count}`}
                  </span>
                </div>
                <div className="mt-1 font-mono text-[11px] text-[var(--text-muted)] truncate">
                  {repo.branch} · {repo.head || "—"}
                </div>
                <div className="mt-1 text-[11px] text-[var(--text-muted)] line-clamp-2">
                  {repo.suggested_action}
                </div>
              </div>
            );
          })
        ) : (
          <div className="rounded-md border border-dashed border-current/20 py-6 text-center text-[13px] text-[var(--text-muted)]">—</div>
        )}

        {repos.length > 5 && (
          <div className="pt-1 text-[11px] text-[var(--text-muted)]">還有 {repos.length - 5} 個倉庫</div>
        )}
      </div>
    </div>
  );
}

function TaskVisualSyncCard({ projects }: { projects: Project[] }) {
  const tasks = buildVisualSyncTasks(projects);
  if (projects.length === 0 || tasks.length === 0) return null;

  const missingHeptabase = tasks.filter((task) => !task.external_refs?.heptabase?.card_id);
  const canvasPending = tasks.filter((task) => task.external_refs?.heptabase?.card_id && !task.external_refs.heptabase.synced_at);
  const aligned = tasks.filter((task) => task.external_refs?.heptabase?.card_id && task.external_refs.heptabase.synced_at);
  const shownMissing = missingHeptabase.slice(0, 4);
  const shownCanvas = canvasPending.slice(0, 4);
  const shownAligned = aligned.slice(0, 5);

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <div className="text-[13px] font-medium tracking-wide text-[var(--text)]">Task 視覺同步</div>
        <div className="text-[11px] text-[var(--text-muted)]">MC source · Heptabase 白板 · Obsidian Canvas</div>
        <div className="flex-1 border-t border-[var(--border)]"></div>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <VisualSyncColumn title="待補 Heptabase" count={missingHeptabase.length} tone="yellow" tasks={shownMissing} emptyText="目前追蹤範圍都有 card_id" />
          <VisualSyncColumn title="Canvas 待確認" count={canvasPending.length} tone="red" tasks={shownCanvas} emptyText="沒有缺 synced_at 的 task" />
          <VisualSyncColumn title="已對齊" count={aligned.length} tone="green" tasks={shownAligned} emptyText="尚無完整 refs" />
        </div>

        <div className="mt-4 pt-3 border-t border-[var(--border)] flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--text-muted)]">
          <span>tracked <span className="font-mono text-[var(--text)]">{tasks.length}</span></span>
          <span>Heptabase gaps <span className="font-mono text-[var(--text)]">{missingHeptabase.length}</span></span>
          <span>Canvas gaps <span className="font-mono text-[var(--text)]">{canvasPending.length}</span></span>
          <span>source <span className="font-mono text-[var(--text)]">projects.json</span></span>
        </div>
      </div>
    </div>
  );
}

function VisualSyncColumn({
  title,
  count,
  tone,
  tasks,
  emptyText,
}: {
  title: string;
  count: number;
  tone: "yellow" | "red" | "green";
  tasks: VisualSyncTask[];
  emptyText: string;
}) {
  const color = tone === "yellow" ? "text-yellow-400" : tone === "red" ? "text-red-400" : "text-green-400";
  const dotStatus = tone === "yellow" ? "needs_fix" : tone === "red" ? "blocked" : "completed";

  return (
    <div className="rounded-lg border border-[var(--border)] bg-black/10 p-4 min-w-0">
      <div className="flex items-baseline justify-between gap-3 pb-2 mb-3 border-b border-[var(--border)]">
        <div className="text-[12px] text-[var(--text-muted)]">{title}</div>
        <div className={`text-[22px] leading-none font-semibold ${count > 0 ? color : "text-[var(--text)]"}`}>{count}</div>
      </div>

      {tasks.length > 0 ? (
        <div className="space-y-2">
          {tasks.map((task) => (
            <div key={`${task.project}-${task.id}`} className="min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <StatusDot status={dotStatus} />
                <span className="font-mono text-[11px] text-[var(--text)] truncate">{task.order_label || task.id}</span>
                <span className={visualSyncTagClass(tone)}>{task.external_refs?.heptabase?.sync_mode || (tone === "yellow" ? "no card" : "sync")}</span>
              </div>
              <div className="mt-0.5 pl-4 text-[11px] text-[var(--text-muted)] truncate">
                {task.projectName} · {task.external_refs?.heptabase?.whiteboard || task.track || "no whiteboard"}
                {task.external_refs?.heptabase?.card_id ? ` · ${task.external_refs.heptabase.card_id.slice(0, 8)}` : ""}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-[12px] text-[var(--text-muted)] opacity-70">{emptyText}</div>
      )}
    </div>
  );
}

function visualSyncTagClass(tone: "yellow" | "red" | "green") {
  const base = "ml-auto shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-mono";
  if (tone === "yellow") return `${base} border-yellow-400/30 text-yellow-400`;
  if (tone === "red") return `${base} border-red-400/30 text-red-400`;
  return `${base} border-green-400/30 text-green-400`;
}

function buildVisualSyncTasks(projects: Project[]): VisualSyncTask[] {
  const trackedProjects = new Set(["harness-mc", "notyet-md", "writing-system"]);
  const trackedNeedles = ["morrowise", "visual-sync", "brand-", "article-seed", "morrowise"];

  return projects
    .flatMap((project) =>
      project.tasks.map((task) => ({
        ...task,
        project: project.project,
        projectName: project.name,
      }))
    )
    .filter((task) => {
      const haystack = `${task.id} ${task.title || ""} ${task.summary || ""}`.toLowerCase();
      return (
        Boolean(task.external_refs?.heptabase) ||
        task.completed_at === "2026-06-20" ||
        (trackedProjects.has(task.project) && trackedNeedles.some((needle) => haystack.includes(needle)))
      );
    })
    .sort((a, b) => visualSyncRank(a) - visualSyncRank(b) || a.project.localeCompare(b.project) || a.id.localeCompare(b.id));
}

function visualSyncRank(task: VisualSyncTask) {
  if (!task.external_refs?.heptabase?.card_id) return 0;
  if (!task.external_refs.heptabase.synced_at) return 1;
  return 2;
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
        <SystemAttentionCard />
        <MorroWiseSurfaceCard projects={projects} />
        <WorktreeStatusCard />
        <TaskVisualSyncCard projects={projects} />

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
