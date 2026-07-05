// Pulse proposal queue (JV-08, morrowise/system-pulse-feedback-loop).
// system-pulse 失敗 → 自動產 proposal 檔入佇列 + 推送摘要。
//
// Source boundary: proposal 檔是 queue/evidence，不是 task 正本；Vincent 裁決後
// 才由人或 session 寫進 tasks.json。本模組不寫 task state、不 commit、不 push。
//
// 分流不新造判準，引用既有制度：
// - S4 兩輪失敗（judgment-externalization-matrix 第一類）：同一 step 連續第 2 次失敗
//   → amber 升 red。
// - E 類熔斷（同矩陣第三類）：需要 Vincent 裁決的 failure（如 task-events pending gate）
//   → red 即推。
// - approval-policy allowed tier：可由本機重跑 generator/sync 修復的 drift（sync:* --check）
//   → auto_fixable，當場修入早報，不單獨推送。
//
// 防自噬（done_condition 明定）：
// - TTL：pending 超過 7 天未裁決 → status 降為 degraded_to_weekly，退出每日推送。
// - 佇列上限 10：超過 → 產生佇列自身的 red overload proposal。
// - 每日 red 推播 ≤3 則：超過自動合併為一則彙總。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(__dirname, "..");

export const PROPOSAL_TTL_DAYS = 7;
export const QUEUE_SOFT_CAP = 10;
export const DAILY_RED_PUSH_CAP = 3;

const TRIAGE_REFS = {
  s4: "$COLLAB/notyet-harness/000_Agent/docs/morrowise/harness/judgment-externalization-matrix.md#S4",
  escalate: "$COLLAB/notyet-harness/000_Agent/docs/morrowise/harness/judgment-externalization-matrix.md#第三類",
  allowed_tier: "$COLLAB/harness-mc/system-workflow/registries/morrowise-approval-policy.json#allowed",
};

export function processPulseProposals(options = {}) {
  const root = options.root || defaultRoot;
  const now = options.now ? new Date(options.now) : new Date();
  const report = options.report || null;
  const pendingDir = path.join(root, "task-proposals", "pending");
  const resolvedDir = path.join(root, "task-proposals", "resolved");
  fs.mkdirSync(pendingDir, { recursive: true });
  fs.mkdirSync(resolvedDir, { recursive: true });

  const created = [];
  const escalated = [];
  const refreshed = [];

  // 1. 從 degraded pulse report 產生/更新 proposals
  if (report && report.status === "degraded") {
    for (const step of report.steps.filter((item) => item.status !== "pass")) {
      const proposalId = `pulse-${slug(step.id)}`;
      const filePath = path.join(pendingDir, `${proposalId}.json`);
      const triage = triageStep(step);

      if (fs.existsSync(filePath)) {
        const existing = readJson(filePath);
        existing.occurrences += 1;
        existing.last_seen_at = now.toISOString();
        existing.failure_excerpt = excerptOf(step);
        // S4 兩輪失敗：同一 step 連續第 2 次 → amber 升 red
        if (existing.severity === "amber" && existing.occurrences >= 2) {
          existing.severity = "red";
          existing.triage_refs = [...new Set([...existing.triage_refs, TRIAGE_REFS.s4])];
          escalated.push(existing);
        } else {
          refreshed.push(existing);
        }
        writeJson(filePath, existing);
        continue;
      }

      const proposal = {
        schema_version: "pulse-proposal.v0",
        proposal_id: proposalId,
        created_at: now.toISOString(),
        last_seen_at: now.toISOString(),
        occurrences: 1,
        severity: triage.severity,
        triage_refs: triage.refs,
        step_id: step.id,
        failure_excerpt: excerptOf(step),
        evidence_ref: "$COLLAB/harness-mc/public/data/system-pulse.json",
        suggested_action: triage.suggestedAction || suggestedActionFor(report, step),
        status: "pending_decision",
        ttl_days: PROPOSAL_TTL_DAYS,
        source_boundary:
          "proposal 檔是 queue/evidence，非 task 正本；Vincent 裁決後才進 tasks.json（approval-policy: direction agreement is not operation approval）",
      };
      writeJson(filePath, proposal);
      created.push(proposal);
    }
  }

  // 1b. 恢復自動結案：本輪 report 中該 step 已 pass → proposal 移到 resolved/
  //（queue 衛生，非 task 裁決；裁決語意仍歸 Vincent）
  const resolvedNow = [];
  if (report) {
    const passedSteps = new Set((report.steps || []).filter((step) => step.status === "pass").map((step) => step.id));
    for (const name of fs.readdirSync(pendingDir).filter((entry) => entry.endsWith(".json"))) {
      const filePath = path.join(pendingDir, name);
      const proposal = readJson(filePath);
      if (proposal.step_id && passedSteps.has(proposal.step_id)) {
        proposal.status = "resolved";
        proposal.resolved = { at: now.toISOString(), reason: "step_recovered", evidence_ref: "$COLLAB/harness-mc/public/data/system-pulse.json" };
        writeJson(path.join(resolvedDir, name), proposal);
        fs.unlinkSync(filePath);
        resolvedNow.push(proposal);
      }
    }
  }

  // 2. TTL sweep：pending 超過 7 天 → degraded_to_weekly（退出每日推播，進週報彙整）
  const pendingFiles = fs.readdirSync(pendingDir).filter((name) => name.endsWith(".json")).sort();
  const proposals = [];
  for (const name of pendingFiles) {
    const proposal = readJson(path.join(pendingDir, name));
    const ageDays = Math.floor((now - new Date(proposal.created_at)) / 86400000);
    if (proposal.status === "pending_decision" && ageDays > proposal.ttl_days) {
      proposal.status = "degraded_to_weekly";
      writeJson(path.join(pendingDir, name), proposal);
    }
    proposals.push({ ...proposal, age_days: ageDays });
  }

  // 3. 佇列上限：pending_decision 超過 QUEUE_SOFT_CAP → 佇列自身 red overload proposal
  const activePending = proposals.filter((proposal) => proposal.status === "pending_decision");
  const overloadPath = path.join(pendingDir, "queue-overload.json");
  if (activePending.length > QUEUE_SOFT_CAP && !fs.existsSync(overloadPath)) {
    const overload = {
      schema_version: "pulse-proposal.v0",
      proposal_id: "queue-overload",
      created_at: now.toISOString(),
      last_seen_at: now.toISOString(),
      occurrences: 1,
      severity: "red",
      triage_refs: [TRIAGE_REFS.escalate],
      step_id: "proposal-queue",
      failure_excerpt: `pending_decision proposals = ${activePending.length} > cap ${QUEUE_SOFT_CAP}`,
      evidence_ref: "$COLLAB/harness-mc/task-proposals/pending",
      suggested_action: "佇列超載代表裁決節奏跟不上偵測節奏：Vincent 批次裁決一輪，或調整 pulse 偵測範圍。",
      status: "pending_decision",
      ttl_days: PROPOSAL_TTL_DAYS,
      source_boundary: "proposal 檔是 queue/evidence，非 task 正本",
    };
    writeJson(overloadPath, overload);
    created.push(overload);
    proposals.push({ ...overload, age_days: 0 });
  }

  // 4. 推播內容：red 即推、每日 ≤3 則、超過合併
  const today = now.toISOString().slice(0, 10);
  const pushables = [...created, ...escalated].filter((proposal) => proposal.severity === "red");
  let pushMessage = null;
  if (pushables.length > 0) {
    const lines = pushables.slice(0, DAILY_RED_PUSH_CAP).map((proposal) => `· ${proposal.proposal_id}: ${proposal.failure_excerpt.slice(0, 80)}`);
    const merged = pushables.length > DAILY_RED_PUSH_CAP ? `（共 ${pushables.length} 則 red，已合併）` : "";
    pushMessage = [`[MorroWise proposals] ${today} red ${pushables.length} 則${merged}`, ...lines, "裁決入口 read $COLLAB/harness-mc/public/data/pulse-proposals.json"].join("\n");
  }

  // 5. Read model（JV-13 System Attention surface 的資料源）
  const oldest = activePending.reduce((max, proposal) => Math.max(max, proposal.age_days), 0);
  const readModel = {
    schema_version: "pulse-proposals.v0",
    generated_at: now.toISOString(),
    read_only: true,
    source_of_truth: "$COLLAB/harness-mc/task-proposals/pending",
    generator: "$COLLAB/harness-mc/scripts/pulse-proposal-queue.mjs",
    output: "$COLLAB/harness-mc/public/data/pulse-proposals.json",
    stale_rule: "Regenerate on every system-pulse run; stale when older than the newest system-pulse.json.",
    counts: {
      pending_decision: activePending.length,
      degraded_to_weekly: proposals.filter((proposal) => proposal.status === "degraded_to_weekly").length,
      red: activePending.filter((proposal) => proposal.severity === "red").length,
      amber: activePending.filter((proposal) => proposal.severity === "amber").length,
      auto_fixable: activePending.filter((proposal) => proposal.severity === "auto_fixable").length,
    },
    oldest_pending_days: oldest,
    proposals: proposals.map(({ age_days, ...proposal }) => ({ ...proposal, age_days })),
    next_action: {
      type: "decision",
      target: activePending[0]?.proposal_id || null,
      label: activePending.length > 0 ? `${activePending.length} proposal(s) 待 Vincent 裁決；裁決後才寫 tasks.json。` : "佇列空，無待裁決。",
    },
    write_boundary: {
      allowed: ["write proposal queue files", "write generated pulse-proposals read model", "compose push message"],
      forbidden: ["modify task state", "close proposals without decision evidence", "commit", "push", "read secrets"],
    },
    verifier_ref: "npm run test:pulse-proposals",
  };

  if (options.write !== false) {
    const outPath = path.join(root, "public", "data", "pulse-proposals.json");
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    writeJson(outPath, readModel);
  }

  return { created, escalated, refreshed, resolved: resolvedNow, proposals, pushMessage, readModel };
}

// 分流：引用 approval-policy allowed tier（本機重跑可修）與 D 矩陣 E 類（需 Vincent 裁決）
function triageStep(step) {
  const text = `${step.stderr_excerpt || ""} ${step.stdout_excerpt || ""}`;
  if (step.id.startsWith("sync:") && /--check|drift|sync/i.test(step.command || step.id)) {
    return {
      severity: "auto_fixable",
      refs: [TRIAGE_REFS.allowed_tier],
      suggestedAction: "本機重跑對應 sync 腳本（不帶 --check）修復 drift 後重驗；屬 approval-policy allowed tier。",
    };
  }
  if (step.id === "task-events:pending-gate" || /Vincent/i.test(text)) {
    return { severity: "red", refs: [TRIAGE_REFS.escalate] };
  }
  return { severity: "amber", refs: [TRIAGE_REFS.s4] };
}

function suggestedActionFor(report, step) {
  const target = report?.next_action?.target;
  return target && target !== "unknown"
    ? `依 pulse next_action 修 ${target}；修復後重跑 system-pulse 驗證。`
    : `檢查 step ${step.id} 的 failure excerpt，修 owning source/verifier 後重跑 system-pulse。`;
}

function excerptOf(step) {
  return (step.stderr_excerpt || step.stdout_excerpt || "no excerpt").split("\n").filter(Boolean).slice(-3).join(" | ").slice(0, 300);
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
