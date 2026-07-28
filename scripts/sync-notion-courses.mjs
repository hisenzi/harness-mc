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

  const task = {
    id: `notion-${page.id.replace(/-/g, "").toLowerCase()}`,
    title: name,
    status: STATUS_MAP[status] || "deferred",
    track: TYPE_TRACK[type] || "course",
    completed_at: status === "DONE" ? new Date().toISOString().slice(0, 10) : null,
    commits: [],
    note: parts.join(" | "),
    summary: "",
    done_condition: `依 Notion 課程總表追蹤「${name}」完成，狀態由 Notion 正本同步為 DONE。`,
    source_ref: {
      system: "Notion",
      page_id: page.id,
      url: page.url,
      database_id: DATABASE_ID,
    },
    mirror_note: "Notion remains source of truth; this task is an MC mirror.",
  };
  if (outputRef) task.output_ref = outputRef;
  return task;
}

function isNotionCourseMirror(task) {
  const mirrorTracks = new Set(["course", "book", "free", "yt"]);
  if (!mirrorTracks.has(String(task?.track || ""))) return false;
  const sourceIsNotion = String(task?.source_ref?.system || "").toLowerCase() === "notion";
  const legacyNotionId = /^notion-[0-9a-f]{12}$/i.test(String(task?.id || ""));
  return sourceIsNotion || legacyNotionId;
}

async function main() {
  const pages = await queryAll();
  console.log(`Fetched ${pages.length} courses from Notion`);

  const courseTasks = pages.map(pageToTask);
  const courseTaskIds = courseTasks.map((task) => task.id);
  if (new Set(courseTaskIds).size !== courseTaskIds.length) {
    throw new Error("Notion course sync produced duplicate task IDs; tasks.json was not written.");
  }

  // Only replace Notion-owned course mirrors; preserve every local canonical task.
  let existingLocalTasks = [];

  if (fs.existsSync(tasksPath)) {
    const raw = JSON.parse(fs.readFileSync(tasksPath, "utf-8"));
    const tasks = Array.isArray(raw) ? raw : raw.tasks || [];
    existingLocalTasks = tasks.filter((task) => !isNotionCourseMirror(task));
  }

  const merged = { tasks: [...existingLocalTasks, ...courseTasks] };

  fs.writeFileSync(tasksPath, JSON.stringify(merged, null, 2));
  console.log(
    `Written ${merged.tasks.length} tasks (${existingLocalTasks.length} local + ${courseTasks.length} Notion mirrors)`
  );
}

main();
