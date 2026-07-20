/**
 * sync-notion-courses.mjs
 * 從 Notion 課程總表拉資料 → 合併到 milestones/self-learning/tasks.json
 *
 * 用法：
 *   NOTION_TOKEN=secret_xxx node scripts/sync-notion-courses.mjs
 *
 * 首次設定：
 *   1. https://www.notion.so/my-integrations → 建立 integration
 *   2. 課程總表 database → ⋯ → 連結 → 選剛建的 integration
 *   3. 把 token 存到 .env：NOTION_TOKEN=secret_xxx
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const tasksPath = path.join(root, "milestones", "self-learning", "tasks.json");

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DATABASE_ID = "53692cdffc61475eb9340f4e291ee59b";

if (!NOTION_TOKEN) {
  console.error("Missing NOTION_TOKEN. Set it via environment variable or .env file.");
  process.exit(1);
}

const STATUS_MAP = {
  NOW: "in_progress",
  NEXT: "todo",
  SOMEDAY: "deferred",
  DONE: "done",
};

const TYPE_TRACK = {
  線上課程: "course",
  書: "book",
  免費資源: "free",
  YT: "yt",
};

async function queryAll() {
  const pages = [];
  let cursor = undefined;

  do {
    const body = {};
    if (cursor) body.start_cursor = cursor;

    const res = await fetch(
      `https://api.notion.com/v1/databases/${DATABASE_ID}/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${NOTION_TOKEN}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );

    if (!res.ok) {
      const err = await res.text();
      console.error(`Notion API error ${res.status}: ${err}`);
      process.exit(1);
    }

    const data = await res.json();
    pages.push(...data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  return pages;
}

function prop(page, name) {
  return page.properties?.[name];
}

function titleText(p) {
  return p?.title?.map((t) => t.plain_text).join("") || "";
}

function selectName(p) {
  return p?.select?.name || "";
}

function numberVal(p) {
  return p?.number ?? null;
}

function formulaVal(p) {
  if (!p?.formula) return null;
  return p.formula.number ?? p.formula.string ?? null;
}

function richText(p) {
  return p?.rich_text?.map((t) => t.plain_text).join("") || "";
}

function urlVal(p) {
  return p?.url || "";
}

function pageToTask(page) {
  const name = titleText(prop(page, "課程名稱"));
  const status = selectName(prop(page, "狀態"));
  const type = selectName(prop(page, "類型"));
  const pillar = selectName(prop(page, "9宮格柱子"));
  const energy = selectName(prop(page, "能量成本"));
  const pct = numberVal(prop(page, "完成%"));
  const triage = formulaVal(prop(page, "Triage總分"));
  const link = urlVal(prop(page, "課程連結"));
  const note = richText(prop(page, "備註"));
  const outputRef = richText(prop(page, "服務輸出"));

  const parts = [];
  if (pillar) parts.push(`柱:${pillar}`);
  if (triage !== null) parts.push(`T:${triage}`);
  if (energy) parts.push(`E:${energy}`);
  if (pct !== null && pct > 0) parts.push(`${pct}%`);
  if (link) parts.push(link);
  if (note) parts.push(note);

  return {
    id: `notion-${page.id.replace(/-/g, "").slice(0, 12)}`,
    title: name,
    status: STATUS_MAP[status] || "deferred",
    track: TYPE_TRACK[type] || "course",
    completed_at: status === "DONE" ? new Date().toISOString().slice(0, 10) : null,
    commits: [],
    note: parts.join(" | "),
    output_ref: outputRef,
    summary: "",
  };
}

async function main() {
  const pages = await queryAll();
  console.log(`Fetched ${pages.length} courses from Notion`);

  const courseTasks = pages.map(pageToTask);

  // Preserve existing non-course tasks (setup/triage/process/operation tracks)
  const SYSTEM_TRACKS = new Set(["setup", "triage", "process", "operation"]);
  let existingSystemTasks = [];

  if (fs.existsSync(tasksPath)) {
    const raw = JSON.parse(fs.readFileSync(tasksPath, "utf-8"));
    const tasks = Array.isArray(raw) ? raw : raw.tasks || [];
    existingSystemTasks = tasks.filter((t) => SYSTEM_TRACKS.has(t.track));
  }

  const merged = { tasks: [...existingSystemTasks, ...courseTasks] };

  fs.writeFileSync(tasksPath, JSON.stringify(merged, null, 2));
  console.log(
    `Written ${merged.tasks.length} tasks (${existingSystemTasks.length} system + ${courseTasks.length} courses)`
  );
}

main();
