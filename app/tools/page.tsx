"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Skill {
  id: string;
  name: string;
  description: string;
  version: string | null;
  lastModified: string;
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
        <div className="space-y-2">
          {filteredSkills.map((skill) => (
            <div
              key={skill.id}
              className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3"
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="font-medium text-body">{skill.name}</span>
                {skill.version && (
                  <span className="text-caption px-1.5 py-0.5 rounded bg-green-500/15 text-green-400">
                    v{skill.version}
                  </span>
                )}
                <span className="text-caption text-[var(--text-muted)] ml-auto">
                  {dateFmt(skill.lastModified)}
                </span>
              </div>
              <p className="text-small text-[var(--text-muted)] line-clamp-2">{skill.description}</p>
            </div>
          ))}
          {filteredSkills.length === 0 && (
            <p className="text-body text-[var(--text-muted)] text-center py-8">無符合結果</p>
          )}
        </div>
      )}

      {/* Scripts */}
      {tab === "scripts" && (
        <div className="space-y-2">
          {filteredScripts.map((script) => {
            const badge = locationBadge[script.location] || { bg: "bg-gray-500/15", text: "text-gray-400" };
            return (
              <div
                key={`${script.location}/${script.name}`}
                className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono font-medium text-body">{script.name}</span>
                  <span className={`text-caption px-1.5 py-0.5 rounded ${badge.bg} ${badge.text}`}>
                    {script.location}
                  </span>
                  <span className="text-caption text-[var(--text-muted)] ml-auto">
                    {dateFmt(script.lastModified)}
                  </span>
                </div>
                <p className="text-small text-[var(--text-muted)] line-clamp-2">{script.description || "—"}</p>
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
        <div className="space-y-2">
          {data.hooks.map((hook, i) => (
            <div
              key={i}
              className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3"
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-caption px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400">
                  {hook.event}
                </span>
                <span className="text-caption px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-400">
                  {hook.matcher}
                </span>
                {hook.statusMessage && (
                  <span className="text-small text-[var(--text-muted)] ml-auto">{hook.statusMessage}</span>
                )}
              </div>
              <code className="text-caption text-[var(--text-muted)] break-all block">{hook.command}</code>
            </div>
          ))}
          {data.hooks.length === 0 && (
            <p className="text-body text-[var(--text-muted)] text-center py-8">尚無 hooks</p>
          )}
        </div>
      )}

      {/* Changes */}
      {tab === "changes" && (
        <div className="space-y-1">
          {data.recentChanges.map((change, i) => (
            <div
              key={i}
              className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3"
            >
              <div className="flex items-center gap-2 mb-1">
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
                <span className="text-body flex-1 truncate">{change.message}</span>
              </div>
              {change.files.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {change.files.map((f) => (
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
