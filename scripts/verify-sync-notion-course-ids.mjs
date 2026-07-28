import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const sourceScript = path.resolve("scripts", "sync-notion-courses.mjs");
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sync-notion-courses-"));
const scriptDir = path.join(tmpRoot, "scripts");
const tasksPath = path.join(tmpRoot, "milestones", "self-learning", "tasks.json");
const copiedScript = path.join(scriptDir, "sync-notion-courses.mjs");
const mockFetch = path.join(tmpRoot, "mock-fetch.mjs");

fs.mkdirSync(scriptDir, { recursive: true });
fs.mkdirSync(path.dirname(tasksPath), { recursive: true });
fs.copyFileSync(sourceScript, copiedScript);
fs.writeFileSync(tasksPath, `${JSON.stringify({
  tasks: [
    {
      id: "system-task",
      title: "既有系統任務",
      status: "todo",
      track: "operation",
    },
    {
      id: "local-book-capture",
      title: "既有本地書籍知識收錄",
      status: "completed",
      track: "book",
    },
    {
      id: "notion-bbbbbbbbbbbb",
      title: "應由同步結果取代的舊 Notion mirror",
      status: "deferred",
      track: "course",
    },
  ],
}, null, 2)}\n`);

const pages = [
  notionPage("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1", "第一門測試課程", "wealth-system/b-6"),
  notionPage("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2", "第二門測試課程"),
];

fs.writeFileSync(mockFetch, `
globalThis.fetch = async () => ({
  ok: true,
  async json() {
    return {
      results: ${JSON.stringify(pages)},
      has_more: false,
      next_cursor: null
    };
  }
});
`);

execFileSync(process.execPath, ["--import", mockFetch, copiedScript], {
  cwd: tmpRoot,
  env: { ...process.env, NOTION_TOKEN: "test-token" },
  encoding: "utf-8",
  stdio: ["ignore", "pipe", "pipe"],
});

const synced = JSON.parse(fs.readFileSync(tasksPath, "utf-8"));
const courses = synced.tasks.filter((task) => task.track === "course");
assert.equal(courses.length, 2);
assert.deepEqual(
  courses.map((task) => task.id),
  [
    "notion-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1",
    "notion-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2",
  ],
  "course task IDs must use the stable full normalized Notion page ID",
);
assert.equal(new Set(courses.map((task) => task.id)).size, courses.length);
assert.equal(synced.tasks.some((task) => task.id === "system-task"), true);
assert.equal(synced.tasks.some((task) => task.id === "local-book-capture"), true);
assert.equal(synced.tasks.some((task) => task.id === "notion-bbbbbbbbbbbb"), false);
assert.equal(courses[0].output_ref, "wealth-system/b-6");

for (const [index, task] of courses.entries()) {
  assert.deepEqual(task.source_ref, {
    system: "Notion",
    page_id: pages[index].id,
    url: pages[index].url,
    database_id: "53692cdffc61475eb9340f4e291ee59b",
  });
  assert.match(task.mirror_note, /Notion.*source of truth/i);
  assert.match(task.done_condition, /Notion 課程總表/);
}

console.log("sync-notion-courses ID verification OK");

function notionPage(id, title, outputRef = "") {
  return {
    id,
    url: `https://app.notion.com/${id.replaceAll("-", "")}`,
    properties: {
      課程名稱: {
        title: [{ plain_text: title }],
      },
      狀態: {
        select: { name: "SOMEDAY" },
      },
      類型: {
        select: { name: "線上課程" },
      },
      服務輸出: {
        rich_text: outputRef ? [{ plain_text: outputRef }] : [],
      },
    },
  };
}
