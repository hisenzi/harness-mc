"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Course {
  id: string;
  title: string;
  status: string;
  track: string;
  note: string;
  pillar?: string;
  triage?: number;
  energy?: string;
  pct?: number;
  link?: string;
  output_ref?: string;
}

interface LearningData {
  summary: {
    total: number;
    now: number;
    next: number;
    someday: number;
    done: number;
    byType: Record<string, number>;
  };
  courses: Course[];
}

const statusLabel: Record<string, string> = {
  in_progress: "NOW",
  todo: "NEXT",
  deferred: "SOMEDAY",
  done: "DONE",
};

const statusStyle: Record<string, string> = {
  in_progress: "bg-pink-500/20 text-pink-400",
  todo: "bg-blue-500/20 text-blue-400",
  deferred: "bg-gray-500/20 text-gray-400",
  done: "bg-green-500/20 text-green-400",
};

const trackIcon: Record<string, string> = {
  course: "🎓",
  book: "📖",
  free: "🆓",
  yt: "▶️",
};

const trackLabel: Record<string, string> = {
  course: "線上課程",
  book: "書",
  free: "免費資源",
  yt: "YouTube",
};

function CourseCard({ course }: { course: Course }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[16px] shrink-0">{trackIcon[course.track] || "📄"}</span>
          <span className="font-medium text-body leading-snug line-clamp-2">{course.title}</span>
        </div>
        <span
          className={`text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0 ${statusStyle[course.status] || "bg-gray-500/20 text-gray-400"}`}
        >
          {statusLabel[course.status] || course.status}
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5 text-[11px]">
        {course.pillar && (
          <span className="px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400">
            {course.pillar}
          </span>
        )}
        {course.energy && (
          <span className="px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-400">
            E:{course.energy}
          </span>
        )}
        {course.triage != null && course.triage > 0 && (
          <span className="px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-400">
            T:{course.triage}
          </span>
        )}
        {course.output_ref && (
          <span className="px-1.5 py-0.5 rounded bg-red-500/15 text-red-300">
            服務輸出：{course.output_ref}
          </span>
        )}
      </div>

      {(course.pct != null && course.pct > 0) && (
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded-full bg-[var(--border)] overflow-hidden">
            <div
              className="h-full rounded-full bg-pink-500 transition-all"
              style={{ width: `${course.pct}%` }}
            />
          </div>
          <span className="text-[11px] text-[var(--text-muted)]">{course.pct}%</span>
        </div>
      )}

      <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)] mt-auto">
        <span>{trackLabel[course.track] || course.track}</span>
        {course.link && (
          <a
            href={course.link}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-[var(--text)] transition"
            onClick={(e) => e.stopPropagation()}
          >
            連結 ↗
          </a>
        )}
      </div>
    </div>
  );
}

export default function LearningPage() {
  const [data, setData] = useState<LearningData | null>(null);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/data/learning.json`)
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-[var(--text-muted)]">載入中...</p>
      </div>
    );
  }

  const filters = [
    { key: "all", label: `全部 ${data.summary.total}` },
    { key: "in_progress", label: `NOW ${data.summary.now}` },
    { key: "todo", label: `NEXT ${data.summary.next}` },
    { key: "deferred", label: `SOMEDAY ${data.summary.someday}` },
    { key: "done", label: `DONE ${data.summary.done}` },
  ];

  const typeFilters = Object.entries(data.summary.byType).map(([k, v]) => ({
    key: `type:${k}`,
    label: `${trackIcon[k] || ""} ${v}`,
  }));

  const courses = data.courses.filter((c) => {
    if (filter === "all") return true;
    if (filter.startsWith("type:")) return c.track === filter.slice(5);
    return c.status === filter;
  });

  const statusOrder = ["in_progress", "todo", "deferred", "done"];
  courses.sort((a, b) => {
    const sa = statusOrder.indexOf(a.status);
    const sb = statusOrder.indexOf(b.status);
    if (sa !== sb) return sa - sb;
    return (b.triage || 0) - (a.triage || 0);
  });

  return (
    <main className="min-h-screen p-4 md:p-8 max-w-6xl mx-auto">
      <div className="mb-6">
        <div className="flex items-center gap-2">
          <Link href="/" className="text-[var(--text-muted)] hover:text-[var(--text)] text-body">
            ← MC
          </Link>
          <h1 className="text-title font-bold">學習資源庫</h1>
        </div>
        <p className="text-[var(--text-muted)] text-body mt-1">
          課程是專案輸入；共 {data.summary.total} 項 · NOW {data.summary.now} · NEXT {data.summary.next} · DONE {data.summary.done}
        </p>

        <div className="flex flex-wrap gap-1.5 mt-3">
          {filters.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`px-2.5 py-1 text-[12px] rounded-md transition ${
                filter === f.key
                  ? "bg-pink-500/40 text-white"
                  : "bg-[var(--border)]/30 text-[var(--text-muted)] hover:text-[var(--text)]"
              }`}
            >
              {f.label}
            </button>
          ))}
          <span className="w-px h-5 bg-[var(--border)] self-center mx-1" />
          {typeFilters.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`px-2.5 py-1 text-[12px] rounded-md transition ${
                filter === f.key
                  ? "bg-pink-500/40 text-white"
                  : "bg-[var(--border)]/30 text-[var(--text-muted)] hover:text-[var(--text)]"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {courses.map((c) => (
          <CourseCard key={c.id} course={c} />
        ))}
      </div>

      {courses.length === 0 && (
        <div className="text-center text-[var(--text-muted)] mt-12">
          此分類沒有課程
        </div>
      )}
    </main>
  );
}
