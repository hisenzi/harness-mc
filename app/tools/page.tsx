"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface ChangelogEntry {
  version: string;
  date: string;
  summary: string;
  details: string;
  commits: string[];
}

interface Skill {
  id: string;
  name: string;
  description: string;
  version: string | null;
  lastModified: string;
  changelog: ChangelogEntry[];
}

interface Script {
  name: string;
  description: string;
  location: string;
  lastModified: string;
}

interface Hook {
  event: string;
  matcher: string;
  type: string;
  command: string;
  statusMessage: string | null;
}

interface Change {
  date: string;
  message: string;
  repo: string;
  files: string[];
}

interface ToolsData {
  generatedAt: string;
  summary: { totalSkills: number; totalScripts: number; totalHooks: number };
  skills: Skill[];
  scripts: Script[];
  hooks: Hook[];
  recentChanges: Change[];
}

type Tab = "skills" | "scripts" | "hooks" | "changes";

const locationBadge: Record<string, { bg: string; text: string }> = {
  "000_Agent": { bg: "bg-blue-500/15", text: "text-blue-400" },
  "harness-mc": { bg: "bg-orange-500/15", text: "text-orange-400" },
};

function dateFmt(iso: string) {
  return iso ? iso.slice(0, 10) : "—";
}

export default function ToolsPage() {
  const [data, setData] = useState<ToolsData | null>(null);
  const [tab, setTab] = useState<Tab>("skills");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/data/tools.json`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, []);

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-[var(--text-muted)]">載入中...</p>
      </div>
    );
  }

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "skills", label: "Skills", count: data.summary.totalSkills },
    { key: "scripts", label: "Scripts", count: data.summary.totalScripts },
    { key: "hooks", label: "Hooks", count: data.summary.totalHooks },
    { key: "changes", label: "變更紀錄", count: data.recentChanges.length },
  ];

  const q = search.toLowerCase();

  const filteredSkills = data.skills.filter(
    (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
  );
  const filteredScripts = data.scripts.filter(
    (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
  );

  return (
    <main className="min-h-screen p-4 md:p-8 max-w-5xl mx-auto">
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <Link href="/" className="text-[var(--text-muted)] hover:text-[var(--text)] text-body">
            ← MC
          </Link>
          <h1 className="text-title font-bold">工具</h1>
        </div>
        <p className="text-body text-[var(--text-muted)]">
          {data.summary.totalSkills} skills · {data.summary.totalScripts} scripts · {data.summary.totalHooks} hooks
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-[var(--border)]/30 rounded-lg p-0.5 mb-4">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 text-small font-medium rounded-md transition ${
              tab === t.key
                ? "bg-[var(--accent)] text-white shadow-sm"
                : "text-[var(--text-muted)] hover:text-[var(--text)]"
            }`}
          >
            {t.label} ({t.count})
          </button>
        ))}
      </div>

      {/* Search */}
      {(tab === "skills" || tab === "scripts") && (
        <input
          type="text"
          placeholder="搜尋..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full mb-4 px-3 py-2 text-body rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
        />
      )}

      {/* Skills */}
      {tab === "skills" && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
          {filteredSkills.map((skill) => {
            const isOpen = expanded.has(skill.id);
            const hasChangelog = skill.changelog && skill.changelog.length > 0;
            return (
              <div
                key={skill.id}
                className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 flex flex-col"
              >
                <div
                  className={`flex items-start gap-2 ${hasChangelog ? "cursor-pointer" : ""}`}
                  onClick={() => {
                    if (!hasChangelog) return;
                    setExpanded((prev) => {
                      const next = new Set(prev);
                      if (next.has(skill.id)) next.delete(skill.id);
                      else next.add(skill.id);
                      return next;
                    });
                  }}
                >
                  {hasChangelog && (
                    <span className="text-caption text-[var(--text-muted)] mt-0.5 shrink-0">{isOpen ? "▼" : "▶"}</span>
                  )}
                  <span className="font-medium text-body line-clamp-2 min-h-[52px] flex-1">{skill.name}</span>
                </div>
                <div className="flex justify-between items-center w-full text-caption text-[var(--text-muted)] mt-1 min-h-[20px]">
                  <span className="flex gap-1.5 items-center">
                    {skill.version && (
                      <span className="px-1.5 py-0.5 rounded bg-green-500/15 text-green-400">v{skill.version}</span>
                    )}
                    {hasChangelog && <span>{skill.changelog.length} 版</span>}
                  </span>
                  <span className="shrink-0">{dateFmt(skill.lastModified)}</span>
                </div>
                <p className="text-small text-[var(--text-muted)] line-clamp-2 mt-1.5 w-full">{skill.description}</p>

                {isOpen && hasChangelog && (
                  <div className="mt-3 pt-3 border-t border-[var(--border)] space-y-3">
                    {skill.changelog.map((entry, i) => (
                      <div key={i} className="flex gap-3">
                        <div className="flex flex-col items-center">
                          <span className={`text-caption px-1.5 py-0.5 rounded font-mono ${
                            i === 0 ? "bg-green-500/15 text-green-400" : "bg-[var(--border)]/50 text-[var(--text-muted)]"
                          }`}>
                            v{entry.version}
                          </span>
                          {i < skill.changelog.length - 1 && (
                            <div className="w-px flex-1 bg-[var(--border)] mt-1" />
                          )}
                        </div>
                        <div className="flex-1 pb-1">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-small font-medium">{entry.summary}</span>
                            <span className="text-caption text-[var(--text-muted)]">{entry.date}</span>
                          </div>
                          {entry.details && (
                            <p className="text-caption text-[var(--text-muted)] mb-1">{entry.details}</p>
                          )}
                          {entry.commits.length > 0 && (
                            <div className="flex gap-1.5 flex-wrap">
                              {entry.commits.map((hash) => (
                                <span key={hash} className="text-caption font-mono px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-400">
                                  {hash.slice(0, 7)}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {filteredSkills.length === 0 && (
            <p className="text-body text-[var(--text-muted)] text-center py-8">無符合結果</p>
          )}
        </div>
      )}

      {/* Scripts */}
      {tab === "scripts" && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
          {filteredScripts.map((script) => {
            const badge = locationBadge[script.location] || { bg: "bg-gray-500/15", text: "text-gray-400" };
            return (
              <div
                key={`${script.location}/${script.name}`}
                className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 flex flex-col"
              >
                <span className="font-mono font-medium text-body line-clamp-2 min-h-[52px] block break-all">{script.name}</span>
                <div className="flex justify-between items-center w-full text-caption mt-1 min-h-[20px]">
                  <span className={`px-1.5 py-0.5 rounded ${badge.bg} ${badge.text}`}>{script.location}</span>
                  <span className="text-[var(--text-muted)] shrink-0">{dateFmt(script.lastModified)}</span>
                </div>
                <p className="text-small text-[var(--text-muted)] line-clamp-2 mt-1.5 w-full">{script.description || "—"}</p>
              </div>
            );
          })}
          {filteredScripts.length === 0 && (
            <p className="text-body text-[var(--text-muted)] text-center py-8">無符合結果</p>
          )}
        </div>
      )}

      {/* Hooks */}
      {tab === "hooks" && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
          {data.hooks.map((hook, i) => (
            <div
              key={i}
              className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 flex flex-col"
            >
              <div className="flex flex-wrap items-center gap-2 mb-2 min-h-[52px]">
                <span className="text-caption px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400">
                  {hook.event}
                </span>
                <span className="text-caption px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-400">
                  {hook.matcher}
                </span>
                {hook.statusMessage && (
                  <span className="text-small text-[var(--text-muted)] w-full">{hook.statusMessage}</span>
                )}
              </div>
              <code className="text-caption text-[var(--text-muted)] break-all block line-clamp-3">{hook.command}</code>
            </div>
          ))}
          {data.hooks.length === 0 && (
            <p className="text-body text-[var(--text-muted)] text-center py-8">尚無 hooks</p>
          )}
        </div>
      )}

      {/* Changes */}
      {tab === "changes" && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
          {data.recentChanges.map((change, i) => (
            <div
              key={i}
              className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 flex flex-col"
            >
              <div className="flex items-center gap-2 mb-1 min-h-[20px]">
                <span className="text-caption text-[var(--text-muted)]">{change.date}</span>
                <span
                  className={`text-caption px-1.5 py-0.5 rounded ${
                    change.repo === "harness-mc"
                      ? "bg-orange-500/15 text-orange-400"
                      : "bg-blue-500/15 text-blue-400"
                  }`}
                >
                  {change.repo}
                </span>
              </div>
              <span className="text-body line-clamp-2 min-h-[48px] block">{change.message}</span>
              {change.files.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {change.files.slice(0, 6).map((f) => (
                    <span key={f} className="text-caption text-[var(--text-muted)] font-mono">
                      {f}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
          {data.recentChanges.length === 0 && (
            <p className="text-body text-[var(--text-muted)] text-center py-8">無變更紀錄</p>
          )}
        </div>
      )}
    </main>
  );
}
