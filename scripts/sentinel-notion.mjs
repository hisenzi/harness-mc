// sentinel-notion.mjs — 哨兵 → Notion PAI 行動庫「重要提醒」（sn-5）
// 讀 public/data/changes.json，有待裁決事項時 upsert 一張當日卡：
//   狀態=待追蹤（命中重要提醒 view filter：狀態=待追蹤 OR 是否逾期）、領域=Harness、Deadline=今天
// 前置（Vincent 一次性）：Notion PAI 行動庫 → ⋯ → Connections → 連結 "MC Sync" integration
// 防重：同日重跑 = update 同一張卡，不重複建卡。未授權時 exit 2 優雅降級（不擋 sentinel-diff --push）。
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const DATABASE_ID = "cb313a88c82541d4a421261fbac49270"; // PAI 行動庫（原始資料庫）

// 讀 token：.env 檔優先，process.env fallback
function loadToken() {
  if (process.env.NOTION_TOKEN) return process.env.NOTION_TOKEN;
  const envPath = path.join(root, ".env");
  if (!fs.existsSync(envPath)) return null;
  const m = fs.readFileSync(envPath, "utf-8").match(/^NOTION_TOKEN=(.+)$/m);
  return m ? m[1].trim() : null;
}

const TOKEN = loadToken();
if (!TOKEN) {
  console.error("sentinel-notion: NOTION_TOKEN 不存在（.env）— 略過");
  process.exit(2);
}

const changesPath = path.join(root, "public", "data", "changes.json");
if (!fs.existsSync(changesPath)) {
  console.error("sentinel-notion: changes.json 不存在，先跑 sentinel-diff.mjs — 略過");
  process.exit(2);
}
const changes = JSON.parse(fs.readFileSync(changesPath, "utf-8"));

const hasNews = (changes.events?.length || 0) > 0 || (changes.stale?.length || 0) > 0;
if (!hasNews || changes.error) {
  console.log("sentinel-notion: 無待裁決事項，不建卡");
  process.exit(0);
}

const today = changes.generated_at.slice(0, 10);
const title = `🛰 MC 哨兵 ${today}`;

// 說明欄：brief + stale + new blocked（重要提醒 view 顯示 說明 欄）
const lines = [changes.brief.replace(/^今日：/, "")];
for (const s of changes.stale || []) lines.push(`⚠ ${s.projectName}：${s.reasons.join("；")}`);
for (const ev of changes.events || [])
  if (ev.type === "new_blocked") lines.push(`● new blocked：${ev.projectName} / ${ev.title}`);
const desc = lines.join("　");

async function api(pathname, method, body) {
  const res = await fetch(`https://api.notion.com/v1${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) {
    if (data.code === "object_not_found" || res.status === 404) {
      console.error('sentinel-notion: PAI 行動庫尚未分享給 "MC Sync" integration（Notion → 行動庫 ⋯ → Connections）— 略過');
      process.exit(2);
    }
    throw new Error(`Notion API ${res.status}: ${data.message || ""}`);
  }
  return data;
}

const props = {
  專案: { title: [{ text: { content: title } }] },
  狀態: { select: { name: "待追蹤" } },
  領域: { select: { name: "Harness" } },
  說明: { rich_text: [{ text: { content: desc.slice(0, 1900) } }] },
  Deadline: { date: { start: today } },
};

const existing = await api(`/databases/${DATABASE_ID}/query`, "POST", {
  filter: { property: "專案", title: { contains: title } },
  page_size: 1,
});

if (existing.results.length > 0) {
  await api(`/pages/${existing.results[0].id}`, "PATCH", { properties: props });
  console.log(`sentinel-notion: 已更新當日卡「${title}」`);
} else {
  await api("/pages", "POST", { parent: { database_id: DATABASE_ID }, properties: props });
  console.log(`sentinel-notion: 已建卡「${title}」→ 重要提醒`);
}
