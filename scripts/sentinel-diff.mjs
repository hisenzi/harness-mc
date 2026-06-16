// sentinel-diff.mjs — MC 哨兵：milestones 變化偵測（sn-2）
// 基線 = git 24h 前的 rev（git 本身是快照庫，無額外狀態檔）；現況 = working tree（含未 commit 變更）。
// 輸出 public/data/changes.json；--brief 印人類簡報；--push 推 Notion/Telegram（防重）。
// 任何內部錯誤都要產出合法 changes.json，不能讓 CI build 掛掉。
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync, spawnSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const milestonesDir = path.join(root, "milestones");
const outPath = path.join(root, "public", "data", "changes.json");
// notyet-harness 是 $COLLAB 下的兄弟 repo；runs/ 被 gitignore，作 push 防重標記用
const scheduleRunsDir = path.join(root, "..", "notyet-harness", "schedule", "runs");

const args = process.argv.slice(2);
const BRIEF = args.includes("--brief");
const PUSH = args.includes("--push");
const sinceIdx = args.indexOf("--since");
const SINCE = sinceIdx >= 0 ? args[sinceIdx + 1] : "24 hours ago";

const DONE = new Set(["done", "completed", "fixed"]);
const norm = (s) => String(s || "").toLowerCase().replace("-", "_");

function git(cmd) {
  return execSync(`git ${cmd}`, { cwd: root, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

// 與 generate-data.mjs 相同的多格式 parser
function parseTasks(raw) {
  let list = [];
  if (Array.isArray(raw)) list = raw;
  else if (Array.isArray(raw?.tasks)) list = raw.tasks;
  else if (Array.isArray(raw?.dev)) list = [...raw.dev, ...(raw.ops || [])];
  else if (Array.isArray(raw?.phases))
    list = raw.phases.flatMap((p) => (p.tasks || []).map((t) => ({ ...t, track: t.track || p.id })));
  const map = new Map();
  for (const t of list) {
    if (!t?.id) continue;
    map.set(String(t.id), { id: String(t.id), title: t.title || t.description || "", status: norm(t.status), note: t.note || "" });
  }
  return map;
}

function readJSON(text) {
  try { return JSON.parse(text.replace(/^﻿/, "")); } catch { return null; }
}

function projectName(dir) {
  const p = path.join(milestonesDir, dir, "project.json");
  if (!fs.existsSync(p)) return dir;
  const meta = readJSON(fs.readFileSync(p, "utf-8"));
  return meta?.name || dir;
}

const result = {
  version: 1,
  generated_at: new Date().toISOString(),
  baseline: { rev: null, time: null, since: SINCE },
  summary: { done_added: 0, new_blocked: 0, unblocked: 0, new_tasks: 0, stale_projects: 0 },
  brief: "",
  events: [],
  stale: [],
  blocked_now: [],
  error: null,
};

try {
  let baseRev = git(`rev-list -1 --before="${SINCE}" HEAD`);
  if (!baseRev) baseRev = git("rev-list --max-parents=0 -1 HEAD"); // repo 比 since 還新 → 用首個 commit
  result.baseline.rev = baseRev.slice(0, 7);
  result.baseline.time = git(`show -s --format=%cI ${baseRev}`);

  const dirs = fs.readdirSync(milestonesDir).filter((d) => fs.existsSync(path.join(milestonesDir, d, "tasks.json")));

  for (const dir of dirs) {
    const name = projectName(dir);
    const curRaw = readJSON(fs.readFileSync(path.join(milestonesDir, dir, "tasks.json"), "utf-8"));
    if (!curRaw) continue;
    const cur = parseTasks(curRaw);

    let base = new Map();
    try {
      base = parseTasks(readJSON(git(`show ${baseRev}:milestones/${dir}/tasks.json`)) || {});
    } catch { /* 基線時專案不存在 → 全部視為新 */ }

    for (const [id, t] of cur) {
      const b = base.get(id);
      const ev = { project: dir, projectName: name, taskId: id, title: t.title, from: b?.status ?? null, to: t.status };

      if (t.status === "blocked") result.blocked_now.push({ project: dir, projectName: name, taskId: id, title: t.title, note: t.note });

      if (!b) {
        if (DONE.has(t.status)) { result.events.push({ type: "done_added", ...ev }); result.summary.done_added++; }
        else if (t.status === "blocked") { result.events.push({ type: "new_blocked", ...ev }); result.summary.new_blocked++; }
        else { result.events.push({ type: "new_task", ...ev }); result.summary.new_tasks++; }
        continue;
      }
      if (b.status === t.status) continue;
      if (DONE.has(t.status) && !DONE.has(b.status)) { result.events.push({ type: "done_added", ...ev }); result.summary.done_added++; }
      else if (t.status === "blocked") { result.events.push({ type: "new_blocked", ...ev }); result.summary.new_blocked++; }
      else if (b.status === "blocked") { result.events.push({ type: "unblocked", ...ev }); result.summary.unblocked++; }
      else result.events.push({ type: "status", ...ev });
    }

    // 衰老掃描（專案級近似）：未 commit 變更 = 今天有動
    const dirty = git(`status --porcelain -- milestones/${dir}`) !== "";
    let lastTouch = result.generated_at;
    if (!dirty) {
      const t = git(`log -1 --format=%cI -- milestones/${dir}`);
      if (t) lastTouch = t;
    }
    const daysSince = Math.floor((Date.now() - new Date(lastTouch).getTime()) / 86400000);
    const counts = { blocked: 0, in_progress: 0, deferred: 0 };
    for (const [, t] of cur) if (t.status in counts) counts[t.status]++;
    const reasons = [];
    if (counts.blocked > 0 && daysSince >= 14) reasons.push(`${counts.blocked} blocked 卡了 ${daysSince} 天`);
    if (counts.in_progress > 0 && daysSince >= 7) reasons.push(`${counts.in_progress} in_progress 但 ${daysSince} 天沒動`);
    if (counts.deferred > 0 && daysSince >= 30) reasons.push(`${counts.deferred} deferred 放了 ${daysSince} 天未重審`);
    if (reasons.length) result.stale.push({ project: dir, projectName: name, daysSince, ...counts, reasons });
  }
  result.summary.stale_projects = result.stale.length;

  const s = result.summary;
  const parts = [];
  if (s.done_added) parts.push(`+${s.done_added} done`);
  if (s.new_blocked) parts.push(`${s.new_blocked} new blocked`);
  if (s.unblocked) parts.push(`${s.unblocked} unblocked`);
  if (s.new_tasks) parts.push(`+${s.new_tasks} new tasks`);
  if (s.stale_projects) parts.push(`${s.stale_projects} stale`);
  result.brief = parts.length ? `今日：${parts.join(" · ")}` : "今日：無變化";
} catch (e) {
  result.error = String(e?.message || e);
  result.brief = "哨兵運行錯誤（changes.json 為空殼）";
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
console.log(`sentinel: ${result.brief}（events ${result.events.length} · blocked_now ${result.blocked_now.length} · baseline ${result.baseline.rev}）`);

if (BRIEF) {
  console.log("");
  for (const ev of result.events.slice(0, 20))
    console.log(`  [${ev.type}] ${ev.projectName} / ${ev.title}${ev.from ? `（${ev.from} → ${ev.to}）` : ""}`);
  if (result.events.length > 20) console.log(`  … 還有 ${result.events.length - 20} 筆`);
  if (result.stale.length) {
    console.log("\n  待裁決（stale）：");
    for (const st of result.stale) console.log(`  ⚠ ${st.projectName}：${st.reasons.join("；")}`);
  }
  if (result.blocked_now.length) {
    console.log(`\n  現存 blocked ${result.blocked_now.length} 筆：`);
    const byProj = {};
    for (const b of result.blocked_now) (byProj[b.projectName] ||= []).push(b);
    for (const [pn, list] of Object.entries(byProj).slice(0, 8))
      console.log(`  · ${pn}（${list.length}）：${list.slice(0, 3).map((b) => b.title).join("、")}${list.length > 3 ? "…" : ""}`);
  }
}

if (PUSH && !result.error) {
  const hasNews = result.events.length > 0 || result.stale.length > 0;
  const today = result.generated_at.slice(0, 10);
  const markPath = path.join(scheduleRunsDir, "sentinel-pushed.log");
  const already = fs.existsSync(markPath) && fs.readFileSync(markPath, "utf-8").includes(today);
  if (!hasNews) console.log("sentinel: 無事可推");
  else if (already) console.log(`sentinel: ${today} 已推過，防重略過`);
  else {
    // Telegram（token 未就緒時 notify.sh exit 2，靜默略過）
    const tg = spawnSync("bash", [path.join(root, "..", "notyet-harness", "schedule", "lib", "notify.sh"), `🛰 MC 哨兵\n${result.brief}\n${result.stale.map((s) => `⚠ ${s.projectName}: ${s.reasons[0]}`).slice(0, 5).join("\n")}`], { encoding: "utf-8" });
    if (tg.status === 0) console.log("sentinel: Telegram 已推");
    // Notion（sentinel-notion.mjs 存在才推）
    const notionScript = path.join(__dirname, "sentinel-notion.mjs");
    let notionOK = false;
    if (fs.existsSync(notionScript)) {
      const nt = spawnSync("node", [notionScript], { encoding: "utf-8", cwd: root });
      process.stdout.write(nt.stdout || "");
      if (nt.status !== 0) process.stderr.write(nt.stderr || "");
      notionOK = nt.status === 0;
    }
    if (tg.status === 0 || notionOK) {
      fs.mkdirSync(scheduleRunsDir, { recursive: true });
      fs.appendFileSync(markPath, `${today} pushed (tg=${tg.status === 0 ? "ok" : "skip"}, notion=${notionOK ? "ok" : "skip"})\n`);
    }
  }
}
