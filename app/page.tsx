"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
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

interface CapabilityReadModel {
  generated_at: string;
  source: string;
  generator: string;
  summary: {
    total: number;
    by_status: Record<string, number>;
    by_type: Record<string, number>;
    needs_attention: number;
  };
  capabilities: {
    id: string;
    type: string;
    provider: string;
    owner_task: string;
    status: "ready" | "blocked" | "legacy" | "prototype" | "unknown";
    next_action: {
      type: string;
      task_id: string;
      description: string;
    };
    latest_history?: {
      date: string;
      event_type: string;
      from_state: string;
      to_state: string;
      reason: string;
      next_action: string;
    };
    history_count: number;
  }[];
}

interface ProactiveLoopScenario {
  scenario_id: string;
  label: string;
  status: "closed" | "waiting_approval" | "open_loop";
  trigger: {
    trigger_id: string;
    risk_level: "low" | "medium" | "high";
    source: string;
  };
  recommendation: {
    recommendation_id: string;
    reason: string;
    suggested_action: string;
    suggested_task_id: string;
    evidence_refs: { type: string; ref: string }[];
    hc_reasoning: string;
    hc_confidence: number;
  };
  approval: {
    requires_approval: boolean;
    policy: string;
    risk_level: "low" | "medium" | "high";
    reason: string;
  };
  action: {
    runner_id: string;
    output_type: string;
    applied: boolean;
    action_class: string;
    summary: string | null;
  };
  feedback: {
    status: string;
    destination: string;
    note: string;
  };
}

interface ProactiveLoopData {
  generated_at: string;
  read_only: boolean;
  boundary: string;
  stages: string[];
  summary: {
    scenarios: number;
    closed: number;
    waiting_approval: number;
    open_loop: number;
    approval_queue: number;
    runner_applied_actions: number;
  };
  scenarios: ProactiveLoopScenario[];
}

interface LiveDashboardAction {
  type: string;
  target: string | null;
  label: string;
}

interface LiveDashboardSurface {
  id: string;
  label: string;
  source_of_truth?: string;
  source_files?: string[];
  generator?: string | string[];
  generated_at?: string | null;
  stale_rule?: string;
  classification?: "live" | "semi_live" | "static_display" | "fake_live_risk";
  freshness_state: "fresh" | "stale" | "degraded" | "manual" | "unknown";
  freshness_reason: string;
  last_updated_at: string | null;
  attention_level: "normal" | "watch" | "needs_review" | "blocked";
  next_action: LiveDashboardAction;
  write_boundary: {
    mode: string;
    allowed?: string[];
    forbidden?: string[];
  };
  verifier_ref?: string;
  drilldown_route?: string;
  metrics?: Record<string, number | string | null>;
}

interface LiveDashboardApproval {
  id: string;
  action_class: string;
  requested_action: string;
  destination: string;
  owner: string;
  created_at: string | null;
  payload_preview: string;
  closure_condition: string;
  write_boundary: string;
}

interface LiveDashboardData {
  schema_version: string;
  generated_at: string;
  read_only: boolean;
  summary: {
    overall_freshness_state: "fresh" | "stale" | "degraded" | "unknown";
    highest_attention_level: "normal" | "watch" | "needs_review" | "blocked";
    primary_next_action: LiveDashboardAction | null;
    approval_wait_count: number;
    stale_surface_count: number;
    degraded_surface_count: number;
    source_counts: Record<string, number>;
  };
  surfaces: LiveDashboardSurface[];
  approval_queue: LiveDashboardApproval[];
  completion_gate: {
    worktree_commit: {
      state: string;
      required_before_verification_result: boolean;
      blocker: string | null;
    };
  };
  verification: {
    verifier_ref: string;
    verifier_refs?: string[];
  };
}

interface VisualSyncTask extends Task {
  project: string;
  projectName: string;
}

const surfaceAnchors: Record<string, string> = {
  system_attention: "#system-attention",
  morrowise_living_system: "#morrowise-system",
  morrowise_proactive_loop: "#morrowise-loop",
  task_event_pipeline: "#task-event-pipeline",
  worktree_status: "#worktree-status",
  api_cli_mcp_capabilities: "#api-cli-mcp-capabilities",
  approval_queue: "#approval-queue",
};

function LiveDashboardSidebar({ data, projects }: { data: LiveDashboardData | null; projects: Project[] }) {
  const totalTasks = projects.reduce((sum, project) => sum + project.total, 0);
  const doneTasks = projects.reduce((sum, project) => sum + project.done, 0);
  const surfaces = data?.surfaces || [];

  return (
    <aside className="xl:sticky xl:top-0 xl:h-screen border-b xl:border-b-0 xl:border-r border-[var(--border)] bg-[#0d0d0d] p-4 xl:overflow-auto">
      <div className="mb-5">
        <div className="h-8 w-8 rounded-lg bg-teal-400 text-black grid place-items-center font-black text-[13px]">MC</div>
        <div className="mt-3 text-[18px] font-bold leading-tight text-[var(--text)]">Mission Control</div>
        <div className="mt-1 text-[12px] leading-relaxed text-[var(--text-muted)]">
          read-only control surface
        </div>
      </div>

      <nav className="space-y-5">
        <SidebarGroup title="Live Dashboard" count={surfaces.length}>
          <SidebarLink href="#live-summary" label="首頁摘要" badge={data?.summary.highest_attention_level || "loading"} active />
          <SidebarLink href="#approval-queue" label="Approval Queue" badge={String(data?.summary.approval_wait_count ?? 0)} />
          <SidebarLink href="#freshness" label="Freshness" badge={data?.summary.overall_freshness_state || "—"} />
        </SidebarGroup>

        <SidebarGroup title="Drill-down" count={surfaces.length}>
          {surfaces.map((surface) => (
            <SidebarLink
              key={surface.id}
              href={surfaceAnchors[surface.id] || "#live-summary"}
              label={surface.label}
              badge={surface.freshness_state}
            />
          ))}
        </SidebarGroup>

        <SidebarGroup title="MC Layers" count={projects.length}>
          <SidebarLink href="#discipline" label="紀律層" badge={`${doneTasks}/${totalTasks}`} />
          <SidebarLink href="#capability" label="能力層" badge="tools" />
          <SidebarLink href="#learning" label="學習層" badge="courses" />
        </SidebarGroup>
      </nav>

      <div className="mt-6 border-t border-[var(--border)] pt-4 text-[11px] leading-relaxed text-[var(--text-muted)]">
        Dashboard surfaces may display state and route attention only. Task state, commits, push, deploy, and external sync stay behind approval gates.
      </div>
    </aside>
  );
}

function SidebarGroup({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--text-muted)]">
        <span>{title}</span>
        <span className="ml-auto rounded-full border border-[var(--border)] px-2 py-0.5 font-mono tracking-normal">{count}</span>
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function SidebarLink({ href, label, badge, active = false }: { href: string; label: string; badge: string; active?: boolean }) {
  return (
    <a
      href={href}
      className={`grid min-h-9 grid-cols-[8px_minmax(0,1fr)_auto] items-center gap-3 border-l-2 px-3 text-[13px] transition ${
        active ? "border-teal-400 bg-teal-400/10 text-[var(--text)]" : "border-transparent text-[var(--text-muted)] hover:bg-white/[0.03]"
      }`}
    >
      <span className={`h-2 w-2 rounded-full ${active ? "bg-teal-400" : "bg-[var(--text-muted)]/50"}`} />
      <span className="truncate">{label}</span>
      <span className="max-w-[86px] truncate rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] font-mono text-[var(--text-muted)]">
        {badge}
      </span>
    </a>
  );
}

function LiveDashboardSummary({ data }: { data: LiveDashboardData | null }) {
  if (!data) {
    return (
      <section id="live-summary" className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
        <div className="text-[13px] text-[var(--text-muted)]">live dashboard read model 載入中</div>
      </section>
    );
  }

  const primary = data.summary.primary_next_action;
  const topSurfaces = [...data.surfaces].sort((a, b) => attentionRank(b.attention_level) - attentionRank(a.attention_level)).slice(0, 4);

  return (
    <section id="live-summary" className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <StatusDot status={attentionStatus(data.summary.highest_attention_level)} />
            <h2 className="text-[22px] font-bold leading-tight text-[var(--text)]">MorroWise Live Dashboard</h2>
            <span className={statePillClass(data.summary.overall_freshness_state)}>{data.summary.overall_freshness_state}</span>
          </div>
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-[var(--text-muted)]">
            首頁只回答現在要不要管、先管哪裡、資料新不新；所有 side effect 都停在 approval 或 worktree-commit gate。
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 lg:min-w-[300px]">
          <SummaryMetric label="attention" value={data.summary.highest_attention_level} tone={data.summary.highest_attention_level === "normal" ? "green" : "yellow"} />
          <SummaryMetric label="approval" value={String(data.summary.approval_wait_count)} tone={data.summary.approval_wait_count > 0 ? "yellow" : "green"} />
          <SummaryMetric label="commit gate" value={data.completion_gate.worktree_commit.state} tone={data.completion_gate.worktree_commit.state === "not_required" ? "green" : "blue"} />
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-[1fr_0.82fr]">
        <div className="rounded-lg border border-[var(--border)] bg-black/10 p-4 min-w-0">
          <div className="mb-3 flex items-center gap-2">
            <div className="text-[12px] font-semibold text-[var(--text)]">Primary Next Action</div>
            <span className="ml-auto font-mono text-[11px] text-[var(--text-muted)]">{primary?.type || "none"}</span>
          </div>
          <div className="text-[14px] leading-relaxed text-[var(--text)]">{primary?.label || "目前沒有 dashboard-level action"}</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {topSurfaces.map((surface) => (
              <a
                key={surface.id}
                href={surfaceAnchors[surface.id] || "#live-summary"}
                className="inline-flex max-w-full items-center gap-2 rounded-full border border-[var(--border)] px-3 py-1 text-[11px] text-[var(--text-muted)] hover:border-[var(--accent)]/50"
              >
                <StatusDot status={attentionStatus(surface.attention_level)} />
                <span className="truncate">{surface.label}</span>
                <span className="font-mono">{surface.freshness_state}</span>
              </a>
            ))}
          </div>
        </div>

        <div id="freshness" className="rounded-lg border border-[var(--border)] bg-black/10 p-4 min-w-0">
          <div className="mb-3 text-[12px] font-semibold text-[var(--text)]">Freshness</div>
          <div className="space-y-2">
            {data.surfaces.slice(0, 6).map((surface) => (
              <div key={surface.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 text-[12px]">
                <div className="min-w-0">
                  <div className="truncate text-[var(--text)]">{surface.label}</div>
                  <div className="truncate text-[11px] text-[var(--text-muted)]">{surface.freshness_reason}</div>
                </div>
                <span className={statePillClass(surface.freshness_state)}>{surface.freshness_state}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[1fr_0.82fr]">
        <div id="approval-queue" className="rounded-lg border border-[var(--border)] bg-black/10 p-4 min-w-0">
          <div className="mb-3 flex items-center gap-2">
            <div className="text-[12px] font-semibold text-[var(--text)]">Approval Queue</div>
            <span className="ml-auto rounded-full border border-yellow-400/30 px-2 py-0.5 font-mono text-[10px] text-yellow-400">{data.approval_queue.length}</span>
          </div>
          <div className="space-y-2">
            {data.approval_queue.length > 0 ? (
              data.approval_queue.slice(0, 3).map((request) => (
                <div key={request.id} className="rounded-md border border-[var(--border)] p-3 text-[12px]">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-[var(--text)] truncate">{request.action_class}</span>
                    <span className="ml-auto text-[11px] text-[var(--text-muted)]">{request.owner}</span>
                  </div>
                  <div className="mt-1 truncate text-[var(--text-muted)]">{request.requested_action} · {request.destination}</div>
                </div>
              ))
            ) : (
              <div className="text-[12px] text-[var(--text-muted)]">沒有待審批項目</div>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-[var(--border)] bg-black/10 p-4">
          <div className="mb-3 text-[12px] font-semibold text-[var(--text)]">Boundary</div>
          <div className="text-[12px] leading-relaxed text-[var(--text-muted)]">
            Read-only. No task mutation, external sync, commit, push, deploy, or approval execution from the homepage.
          </div>
          <div className="mt-3 border-t border-[var(--border)] pt-3 font-mono text-[11px] text-[var(--text-muted)]">
            verifier: {data.verification.verifier_ref}
          </div>
        </div>
      </div>
    </section>
  );
}

function SummaryMetric({ label, value, tone }: { label: string; value: string; tone: "green" | "yellow" | "blue" }) {
  const color = tone === "green" ? "text-green-400" : tone === "yellow" ? "text-yellow-400" : "text-blue-400";
  return (
    <div className="rounded-lg border border-[var(--border)] bg-black/10 p-3 min-w-0">
      <div className="truncate text-[10px] text-[var(--text-muted)]">{label}</div>
      <div className={`mt-1 truncate font-mono text-[13px] font-semibold ${color}`}>{value}</div>
    </div>
  );
}

function attentionRank(level: LiveDashboardSurface["attention_level"]) {
  if (level === "blocked") return 3;
  if (level === "needs_review") return 2;
  if (level === "watch") return 1;
  return 0;
}

function attentionStatus(level: LiveDashboardSurface["attention_level"]) {
  if (level === "blocked") return "blocked";
  if (level === "needs_review") return "needs_fix";
  if (level === "watch") return "in_progress";
  return "completed";
}

function statePillClass(state: LiveDashboardSurface["freshness_state"]) {
  const base = "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-mono";
  if (state === "fresh") return `${base} border-green-400/30 text-green-400`;
  if (state === "stale") return `${base} border-yellow-400/30 text-yellow-400`;
  if (state === "degraded") return `${base} border-red-400/30 text-red-400`;
  if (state === "manual") return `${base} border-blue-400/30 text-blue-400`;
  return `${base} border-[var(--border)] text-[var(--text-muted)]`;
}

function MorroWiseSurfaceCard({ liveDashboard }: { liveDashboard: LiveDashboardData | null }) {
  const surface = liveDashboard?.surfaces.find((item) => item.id === "morrowise_living_system") || null;

  if (!surface) {
    return (
      <div>
        <div className="flex items-center gap-3 mb-3">
          <div className="text-[13px] font-medium tracking-wide text-[var(--text)]">MorroWise 活系統</div>
          <div className="text-[11px] text-[var(--text-muted)]">read model 載入中</div>
          <div className="flex-1 border-t border-[var(--border)]"></div>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-[13px] text-[var(--text-muted)]">
          morrowise-live-dashboard.json 尚未載入
        </div>
      </div>
    );
  }

  const generatedAt = surface.generated_at || surface.last_updated_at;
  const generatedLabel = generatedAt
    ? new Date(generatedAt).toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "unknown";
  const generator = Array.isArray(surface.generator) ? surface.generator.join(" -> ") : surface.generator || "unknown";
  const sourceFiles = (surface.source_files || []).slice(0, 3).join(" · ") || "none";
  const forbiddenWrites = surface.write_boundary.forbidden?.join(" · ") || "No forbidden write list";
  const allowedReads = surface.write_boundary.allowed?.join(" · ") || "Read-only summary";
  const metrics = surface.metrics || {};
  const sourceStatus = attentionStatus(surface.attention_level);

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <div className="text-[13px] font-medium tracking-wide text-[var(--text)]">MorroWise 活系統</div>
        <div className="text-[11px] text-[var(--text-muted)]">
          read model · {generatedLabel} 更新
        </div>
        <div className="flex-1 border-t border-[var(--border)]"></div>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <div className="grid grid-cols-1 xl:grid-cols-[0.96fr_1.04fr] gap-4 items-stretch">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <StatusDot status={sourceStatus} />
              <div className="text-[12px] font-semibold text-[var(--text)]">{surface.label}</div>
              <span className={statePillClass(surface.freshness_state)}>{surface.freshness_state}</span>
              <span className={classificationPillClass(surface.classification)}>{surface.classification || "unknown"}</span>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <ReadModelField label="source_of_truth" value={surface.source_of_truth || "unknown"} mono />
              <ReadModelField label="freshness_state" value={surface.freshness_state} mono />
              <ReadModelField label="classification" value={surface.classification || "unknown"} mono />
              <ReadModelField label="generated_at" value={generatedLabel} mono />
              <ReadModelField label="verifier_ref" value={surface.verifier_ref || "unknown"} mono />
              <ReadModelField label="metrics" value={`tasks ${metrics.tasks ?? "?"} · completed ${metrics.completed ?? "?"}`} mono />
            </div>

            <div className="mt-3 rounded-lg border border-[var(--border)] bg-black/10 p-3">
              <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">source_files</div>
              <div className="mt-1 line-clamp-2 font-mono text-[11px] leading-relaxed text-[var(--text)]">{sourceFiles}</div>
            </div>
          </div>

          <div className="rounded-lg border border-[var(--border)] bg-black/10 p-3 min-w-0">
            <div className="grid grid-cols-1 gap-3">
              <ReadModelField label="generator" value={generator} mono />
              <ReadModelField label="stale_rule" value={surface.stale_rule || surface.freshness_reason} />
              <div className="rounded-md border border-[var(--border)] bg-white/[0.018] p-3">
                <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">next_action</div>
                <div className="mt-1 flex items-center gap-2 min-w-0">
                  <span className="shrink-0 rounded-full border border-blue-400/30 px-2 py-0.5 font-mono text-[10px] text-blue-400">{surface.next_action.type}</span>
                  <span className="truncate text-[12px] text-[var(--text)]">{surface.next_action.label}</span>
                </div>
                <div className="mt-1 truncate font-mono text-[11px] text-[var(--text-muted)]">{surface.next_action.target || "no target"}</div>
              </div>
              <div className="rounded-md border border-[var(--border)] bg-white/[0.018] p-3">
                <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">write_boundary</div>
                <div className="mt-1 font-mono text-[11px] text-[var(--text)]">{surface.write_boundary.mode}</div>
                <div className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-green-400/90">{allowedReads}</div>
                <div className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-red-400/90">{forbiddenWrites}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReadModelField({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-white/[0.018] p-3 min-w-0">
      <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)] truncate">{label}</div>
      <div className={`mt-1 line-clamp-2 text-[12px] leading-relaxed text-[var(--text)] ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}

function classificationPillClass(classification: LiveDashboardSurface["classification"]) {
  const base = "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-mono";
  if (classification === "live") return `${base} border-green-400/30 text-green-400`;
  if (classification === "semi_live") return `${base} border-yellow-400/30 text-yellow-400`;
  if (classification === "static_display") return `${base} border-blue-400/30 text-blue-400`;
  if (classification === "fake_live_risk") return `${base} border-red-400/30 text-red-400`;
  return `${base} border-[var(--border)] text-[var(--text-muted)]`;
}

function MorroWiseProactiveLoopCard() {
  const [data, setData] = useState<ProactiveLoopData | null>(null);

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/data/morrowise-proactive-loop.json`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, []);

  if (!data) return null;

  const generatedLabel = new Date(data.generated_at).toLocaleString("zh-TW", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const activeScenario = data.scenarios.find((scenario) => scenario.status !== "closed") || data.scenarios[0];

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <div className="text-[13px] font-medium tracking-wide text-[var(--text)]">MorroWise 主動閉環</div>
        <div className="text-[11px] text-[var(--text-muted)]">
          觸發到回饋 · {generatedLabel} 更新 · {data.read_only ? "唯讀" : "可寫入"}
        </div>
        <div className="flex-1 border-t border-[var(--border)]"></div>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <div className="grid grid-cols-1 xl:grid-cols-[0.92fr_1.08fr] gap-4">
          <div className="grid grid-cols-4 gap-2">
            <LoopMetric label="已閉環" value={String(data.summary.closed)} tone="green" />
            <LoopMetric label="等審批" value={String(data.summary.waiting_approval)} tone="yellow" />
            <LoopMetric label="未閉合" value={String(data.summary.open_loop)} tone="red" />
            <LoopMetric label="已執行" value={String(data.summary.runner_applied_actions)} tone="blue" />
          </div>

          <div className="rounded-lg border border-[var(--border)] bg-black/10 p-3 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <StatusDot status={activeScenario ? proactiveLoopDotStatus(activeScenario.status) : "completed"} />
              <div className="text-[12px] font-semibold text-[var(--text)] truncate">
                {activeScenario?.label || "目前沒有未閉合 loop"}
              </div>
              <span className={activeScenario ? proactiveLoopTagClass(activeScenario.status) : proactiveLoopTagClass("closed")}>
                {activeScenario ? proactiveLoopStatusLabel(activeScenario.status) : "已閉環"}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-1 md:grid-cols-[1fr_120px_120px] gap-2 text-[11px] min-w-0">
              <div className="text-[var(--text-muted)] truncate">
                {activeScenario?.recommendation.reason || "read model 沒有回報需要處理的 loop"}
              </div>
              <div className="font-mono text-[var(--text)] truncate">
                {activeScenario?.action.output_type || "summary"}
              </div>
              <div className="font-mono text-[var(--text-muted)] truncate">
                approval {data.summary.approval_queue}
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-[var(--border)] text-[11px] text-[var(--text-muted)] truncate">
              唯讀：不關閉 task、不 commit、不同步外部工具
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function LoopMetric({ label, value, tone }: { label: string; value: string; tone: "green" | "yellow" | "red" | "blue" }) {
  const color =
    tone === "green" ? "text-green-400" : tone === "yellow" ? "text-yellow-400" : tone === "red" ? "text-red-400" : "text-blue-400";
  return (
    <div className="min-h-[70px] rounded-lg border border-[var(--border)] bg-white/[0.018] p-3">
      <div className="text-[10px] text-[var(--text-muted)] truncate">{label}</div>
      <div className={`mt-1 font-mono text-[22px] leading-none font-bold ${color}`}>{value}</div>
    </div>
  );
}

function proactiveLoopDotStatus(status: ProactiveLoopScenario["status"]) {
  if (status === "closed") return "completed";
  if (status === "waiting_approval") return "needs_fix";
  return "blocked";
}

function proactiveLoopStatusLabel(status: ProactiveLoopScenario["status"]) {
  if (status === "closed") return "已閉環";
  if (status === "waiting_approval") return "等審批";
  return "未閉合";
}

function proactiveLoopTagClass(status: ProactiveLoopScenario["status"]) {
  const base = "ml-auto shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-mono";
  if (status === "closed") return `${base} border-green-400/30 text-green-400`;
  if (status === "waiting_approval") return `${base} border-yellow-400/30 text-yellow-400`;
  return `${base} border-red-400/30 text-red-400`;
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

function TaskEventPipelineCard() {
  const [pipeline, setPipeline] = useState<TaskEventPipelineData | null>(null);

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/data/task-events.json`)
      .then((r) => r.json())
      .then(setPipeline)
      .catch(() => {});
  }, []);

  const generatedAt = pipeline?.generated_at ? new Date(pipeline.generated_at) : null;
  const generatedLabel = generatedAt
    ? generatedAt.toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "讀取中";
  const pendingTaskEvents = pipeline?.task_events.pending || 0;
  const pendingSyncEvents = pipeline?.sync_events.pending || 0;
  const rejectedEvents = pipeline?.task_events.rejected || 0;
  const failedSyncEvents = pipeline?.sync_events.failed || 0;
  const needsReview = pendingTaskEvents + pendingSyncEvents + rejectedEvents + failedSyncEvents > 0;
  const recentEvents = [
    ...(pipeline?.recent_task_events || []).map((event) => ({
      id: event.id,
      label: event.type,
      meta: `${event.project}/${event.task_id}`,
      queue: event.queue,
    })),
    ...(pipeline?.recent_sync_events || []).map((event) => ({
      id: event.id,
      label: event.type,
      meta: `${event.target}/${event.project}/${event.task_id}`,
      queue: event.queue,
    })),
  ].slice(0, 4);

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <div className="text-[13px] font-medium tracking-wide text-[var(--text)]">Task Event Pipeline</div>
        <div className="text-[11px] text-[var(--text-muted)]">
          generated {generatedLabel} · reducer queue · read-only
        </div>
        <div className="flex-1 border-t border-[var(--border)]"></div>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <div className="grid grid-cols-1 xl:grid-cols-[0.9fr_1.1fr] gap-4">
          <div className="grid grid-cols-4 gap-2">
            <PipelineMetric label="task pending" value={String(pendingTaskEvents)} tone={pendingTaskEvents > 0 ? "yellow" : "green"} />
            <PipelineMetric label="sync pending" value={String(pendingSyncEvents)} tone={pendingSyncEvents > 0 ? "blue" : "green"} />
            <PipelineMetric label="rejected" value={String(rejectedEvents)} tone={rejectedEvents > 0 ? "red" : "green"} />
            <PipelineMetric label="sync failed" value={String(failedSyncEvents)} tone={failedSyncEvents > 0 ? "red" : "green"} />
          </div>

          <div className="rounded-lg border border-[var(--border)] bg-black/10 p-3 min-w-0">
            <div className="flex items-center gap-2">
              <StatusDot status={needsReview ? "needs_fix" : "completed"} />
              <div className="text-[12px] font-semibold text-[var(--text)]">Queue read model</div>
              <span className="ml-auto font-mono text-[11px] text-[var(--text-muted)]">task-events.json</span>
            </div>
            <div className="mt-3 space-y-2">
              {recentEvents.length > 0 ? (
                recentEvents.map((event) => (
                  <div key={event.id} className="grid grid-cols-[92px_minmax(0,1fr)_auto] gap-2 text-[11px]">
                    <span className="font-mono text-[var(--text)] truncate">{event.queue}</span>
                    <span className="text-[var(--text-muted)] truncate">{event.meta}</span>
                    <span className="rounded-full border border-[var(--border)] px-2 py-0.5 font-mono text-[10px] text-[var(--text-muted)]">{event.label}</span>
                  </div>
                ))
              ) : (
                <div className="text-[12px] text-[var(--text-muted)]">目前沒有 recent queue event</div>
              )}
            </div>
            <div className="mt-3 pt-3 border-t border-[var(--border)] text-[11px] text-[var(--text-muted)]">
              首頁只顯示 queue 狀態；apply、sync、overwrite task files 仍需 reducer / approval gate。
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PipelineMetric({ label, value, tone }: { label: string; value: string; tone: "green" | "yellow" | "blue" | "red" }) {
  const color =
    tone === "green" ? "text-green-400" : tone === "yellow" ? "text-yellow-400" : tone === "blue" ? "text-blue-400" : "text-red-400";
  return (
    <div className="min-h-[70px] rounded-lg border border-[var(--border)] bg-white/[0.018] p-3 min-w-0">
      <div className="truncate text-[10px] text-[var(--text-muted)]">{label}</div>
      <div className={`mt-1 truncate font-mono text-[22px] leading-none font-bold ${color}`}>{value}</div>
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

function ApiCliMcpCapabilityCard({ data }: { data: CapabilityReadModel | null }) {
  if (!data) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
        <div className="text-[13px] text-[var(--text-muted)]">API / CLI / MCP capability read model 載入中</div>
      </div>
    );
  }

  const needsAttention = data.summary.needs_attention;
  const topItems = [...data.capabilities]
    .sort((a, b) => capabilityStatusRank(b.status) - capabilityStatusRank(a.status) || a.id.localeCompare(b.id))
    .slice(0, 4);

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <StatusDot status={needsAttention > 0 ? "needs_fix" : "completed"} />
            <div className="font-semibold text-heading">API / CLI / MCP</div>
          </div>
          <div className="mt-1 text-[11px] text-[var(--text-muted)]">Capability Registry</div>
        </div>
        <span className={needsAttention > 0 ? statePillClass("degraded") : statePillClass("fresh")}>
          {needsAttention > 0 ? `${needsAttention} attention` : "ready"}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <SummaryMetric label="tracked" value={String(data.summary.total)} tone="blue" />
        <SummaryMetric label="ready" value={String(data.summary.by_status.ready || 0)} tone="green" />
        <SummaryMetric label="attention" value={String(needsAttention)} tone={needsAttention > 0 ? "yellow" : "green"} />
      </div>

      <div className="mt-4 space-y-2">
        {topItems.map((item) => (
          <div key={item.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-lg border border-[var(--border)] bg-black/10 px-3 py-2">
            <div className="min-w-0">
              <div className="truncate text-[12px] font-medium text-[var(--text)]">{item.id}</div>
              <div className="truncate text-[11px] text-[var(--text-muted)]">
                {item.latest_history?.event_type || "no history"} · {item.next_action.task_id}
              </div>
            </div>
            <span className={capabilityPillClass(item.status)}>{item.status}</span>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-lg border border-[var(--border)] bg-black/10 p-3 text-[11px] leading-relaxed text-[var(--text-muted)]">
        source: morrowise-capabilities.json · verifier: npm run test:capability-registry · read-only surface
      </div>
    </div>
  );
}

function capabilityStatusRank(status: CapabilityReadModel["capabilities"][number]["status"]) {
  if (status === "blocked") return 4;
  if (status === "unknown") return 3;
  if (status === "legacy") return 2;
  if (status === "prototype") return 1;
  return 0;
}

function capabilityPillClass(status: CapabilityReadModel["capabilities"][number]["status"]) {
  const base = "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-mono";
  if (status === "ready") return `${base} border-green-400/30 text-green-400`;
  if (status === "blocked") return `${base} border-red-400/30 text-red-400`;
  if (status === "legacy") return `${base} border-yellow-400/30 text-yellow-400`;
  if (status === "unknown") return `${base} border-orange-400/30 text-orange-400`;
  return `${base} border-blue-400/30 text-blue-400`;
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
  const [liveDashboard, setLiveDashboard] = useState<LiveDashboardData | null>(null);
  const [capabilities, setCapabilities] = useState<CapabilityReadModel | null>(null);

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/data/projects.json`)
      .then((r) => r.json())
      .then(setProjects)
      .catch(() => {});

    fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/data/morrowise-live-dashboard.json`)
      .then((r) => r.json())
      .then(setLiveDashboard)
      .catch(() => {});

    fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/data/morrowise-capabilities.json`)
      .then((r) => r.json())
      .then(setCapabilities)
      .catch(() => {});
  }, []);

  const totalTasks = projects.reduce((s, p) => s + p.total, 0);
  const doneTasks = projects.reduce((s, p) => s + p.done, 0);

  return (
    <main className="min-h-screen">
      <div className="grid min-h-screen grid-cols-1 xl:grid-cols-[248px_minmax(0,1fr)]">
        <LiveDashboardSidebar data={liveDashboard} projects={projects} />

        <div className="min-w-0 p-5 md:p-8 xl:p-10">
          <div className="mx-auto max-w-6xl">
            <div className="mb-7 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h1 className="text-title font-bold">Mission Control</h1>
                <p className="text-body text-[var(--text-muted)] mt-1">
                  Harness Engineering 四大支柱 · MorroWise live dashboard
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-[11px] text-[var(--text-muted)]">
                <span className="rounded-full border border-[var(--border)] px-3 py-1">read-only homepage</span>
                <span className="rounded-full border border-[var(--border)] px-3 py-1">source: morrowise-live-dashboard.json</span>
              </div>
            </div>

            <div className="space-y-6">
              <LiveDashboardSummary data={liveDashboard} />
              <section id="system-attention"><SystemAttentionCard /></section>
              <section id="task-event-pipeline"><TaskEventPipelineCard /></section>
              <section id="morrowise-system"><MorroWiseSurfaceCard liveDashboard={liveDashboard} /></section>
              <section id="morrowise-loop"><MorroWiseProactiveLoopCard /></section>
              <section id="worktree-status"><WorktreeStatusCard /></section>
              <section id="visual-sync"><TaskVisualSyncCard projects={projects} /></section>

        <div id="discipline">
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

        <div id="capability">
          <div className="flex items-center gap-3 mb-3">
            <div className="text-[13px] font-medium tracking-wide text-[var(--text)]">能力層</div>
            <div className="text-[11px] text-[var(--text-muted)]">Capability Platform — 設定一次，持續存在</div>
            <div className="flex-1 border-t border-[var(--border)]"></div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div id="api-cli-mcp-capabilities">
          <ApiCliMcpCapabilityCard data={capabilities} />
        </div>

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

        <div id="learning">
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
          </div>
        </div>
      </div>
    </main>
  );
}
