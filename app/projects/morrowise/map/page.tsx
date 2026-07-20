import Link from "next/link";
import operatingMap from "../../../../milestones/morrowise/maps/operating-loop.json";

type Node = (typeof operatingMap.nodes)[number];
type Relationship = (typeof operatingMap.relationships)[number];

const statusMeta = {
  verified: { icon: "✅", label: "已驗證", className: "border-emerald-500/45 bg-emerald-500/10" },
  watch: { icon: "🟡", label: "持續觀測", className: "border-amber-400/45 bg-amber-400/10" },
  risk: { icon: "🟠", label: "需處理", className: "border-orange-500/45 bg-orange-500/10" },
  critical: { icon: "🔴", label: "阻塞", className: "border-red-500/55 bg-red-500/10" },
} as const;

const nodesById = new Map(operatingMap.nodes.map((node) => [node.id, node]));

function edgeStyle(relationship: Relationship) {
  if (relationship.type === "guard") return { stroke: "#94a3b8", dash: "6 6", width: 1.5 };
  if (relationship.type === "feedback") return { stroke: "#a78bfa", dash: "4 4", width: 1.5 };
  if (relationship.type === "surface") return { stroke: "#22d3ee", dash: "", width: 1.5 };
  return { stroke: "#64748b", dash: "", width: 1.5 };
}

function ReferenceList({ node }: { node: Node }) {
  return (
    <div className="mt-2 border-t border-white/10 pt-2 text-[11px] leading-4 text-[var(--text-muted)]">
      <div>觀測日：{node.as_of}</div>
      {node.evidence_refs.map((reference) => (
        <div key={reference} className="mt-0.5 break-all font-mono">
          {reference.replace("$COLLAB/harness-mc/", "harness-mc/").replace("$COLLAB/notyet-harness/", "notyet-harness/")}
        </div>
      ))}
    </div>
  );
}

export default function MorroWiseOperatingMapPage() {
  return (
    <main className="min-h-screen p-4 md:p-8 max-w-7xl mx-auto">
      <div className="mb-6">
        <Link href="/projects" className="text-[var(--text-muted)] hover:text-[var(--text)] text-body">
          ← 專案
        </Link>
        <h1 className="mt-2 text-title font-bold">{operatingMap.title}</h1>
        <p className="mt-1 text-body text-[var(--text-muted)]">{operatingMap.diagram_note}</p>
      </div>

      <section className="mb-5 rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-4 text-small text-cyan-100">
        <div className="font-medium">唯讀架構圖</div>
        <p className="mt-1 text-cyan-100/80">{operatingMap.source_boundary}</p>
      </section>

      <section className="overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 md:p-6" aria-label="MorroWise Operating Loop Map">
        <div className="relative h-[870px] min-w-[1000px]">
          <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1000 870" role="img" aria-label="Operating Loop 關係圖">
            <defs>
              <marker id="arrowhead" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                <path d="M0,0 L8,4 L0,8 z" fill="#64748b" />
              </marker>
              <marker id="guard-arrowhead" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                <path d="M0,0 L8,4 L0,8 z" fill="#94a3b8" />
              </marker>
            </defs>
            {operatingMap.relationships.map((relationship) => {
              const from = nodesById.get(relationship.from);
              const to = nodesById.get(relationship.to);
              if (!from || !to) return null;
              const style = edgeStyle(relationship);
              return (
                <line
                  key={`${relationship.from}-${relationship.to}-${relationship.type}`}
                  x1={from.position.x}
                  y1={from.position.y}
                  x2={to.position.x}
                  y2={to.position.y}
                  stroke={style.stroke}
                  strokeWidth={style.width}
                  strokeDasharray={style.dash}
                  markerEnd={`url(#${relationship.type === "guard" ? "guard-arrowhead" : "arrowhead"})`}
                />
              );
            })}
          </svg>

          {operatingMap.nodes.map((node) => {
            const status = statusMeta[node.status as keyof typeof statusMeta];
            return (
              <article
                key={node.id}
                className={`absolute w-[220px] -translate-x-1/2 -translate-y-1/2 rounded-xl border p-3 shadow-lg ${status.className}`}
                style={{ left: node.position.x, top: node.position.y }}
              >
                <div className="flex items-start gap-2">
                  <span aria-hidden="true">{status.icon}</span>
                  <div>
                    <h2 className="text-small font-semibold">{node.label}</h2>
                    <p className="mt-0.5 text-caption text-[var(--text-muted)]">{node.detail}</p>
                  </div>
                </div>
                <div className="mt-2 text-caption text-[var(--text-muted)]">狀態：{status.label}</div>
                <ReferenceList node={node} />
              </article>
            );
          })}
        </div>
      </section>

      <section className="mt-5 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="text-heading font-semibold">關係圖例</h2>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-small text-[var(--text-muted)]">
          <span>實線：主迴路或依賴</span>
          <span className="text-cyan-300">青線：唯讀 surface</span>
          <span className="text-violet-300">虛線：回饋</span>
          <span>灰虛線：驗證守門</span>
        </div>
      </section>
    </main>
  );
}
