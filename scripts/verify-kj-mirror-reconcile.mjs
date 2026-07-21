import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { resolveCollabRoot } from "./collab-root.mjs";

const root = process.cwd();
const collabRoot = resolveCollabRoot(root);
const snapshotPath = path.join(root, "system-workflow/snapshots/kj-notion-tasks-snapshot.json");
const reportPath = path.join(root, "system-workflow/reports/kj-mirror-reconcile-report.md");
const mcMirrorPath = path.join(root, "milestones/kj-bilingual/tasks.json");
const kjAgentsPath = path.join(collabRoot, "CC本機協作_無Git/KJ/260612_KJ_雙語班/AGENTS.md");
const heptabaseNotionStatePath = path.join(collabRoot, "notyet-harness/000_Agent/config/heptabase-notion-sync-state.json");
const heptabasePaiStatePath = path.join(collabRoot, "notyet-harness/000_Agent/config/heptabase-pai-sync-state.json");

const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
const report = fs.readFileSync(reportPath, "utf8");
const mcMirror = JSON.parse(fs.readFileSync(mcMirrorPath, "utf8"));
const kjAgents = fs.readFileSync(kjAgentsPath, "utf8");
const heptabaseNotionState = JSON.parse(fs.readFileSync(heptabaseNotionStatePath, "utf8"));
const heptabasePaiState = JSON.parse(fs.readFileSync(heptabasePaiStatePath, "utf8"));

assert.equal(snapshot.task_anchor, "morrowise/KJ-LIVE-01");
assert.equal(snapshot.source_of_truth.system, "Notion");
assert.equal(snapshot.source_of_truth.data_source_id, "f046f40f-ac75-41ed-afa8-67379159316c");
assert.equal(snapshot.summary.total_tasks, 43);

assert.equal(mcMirror.source_policy, "Notion -> MC tasks.json -> Heptabase / PAI mirrors");
assert.equal(mcMirror.source_of_truth?.system, "Notion");
assert.equal(mcMirror.source_of_truth?.data_source_id, "f046f40f-ac75-41ed-afa8-67379159316c");
assert.equal(mcMirror.mirror_status?.task_anchor, "morrowise/KJ-LIVE-03");
assert.equal(mcMirror.mirror_status?.source_snapshot, "$COLLAB/harness-mc/system-workflow/snapshots/kj-notion-tasks-snapshot.json");
assert.equal(mcMirror.tasks.length, snapshot.summary.total_tasks);

const snapshotByKey = new Map(snapshot.tasks.map((task) => [task.task_key, task]));
const mirrorById = new Map(mcMirror.tasks.map((task) => [task.id, task]));
for (const task of snapshot.tasks) {
  if (!/^[A-FM]\d+$/.test(task.task_key)) continue;
  const mirrorTask = mirrorById.get(task.task_key);
  assert.ok(mirrorTask, `MC mirror missing ${task.task_key}`);
  assert.equal(mirrorTask.notion_title, task.title, `${task.task_key} notion_title drift`);
  assert.equal(mirrorTask.title, stripTaskKey(task.title), `${task.task_key} title drift`);
  assert.equal(mirrorTask.source_ref?.system, "Notion");
  assert.equal(mirrorTask.source_ref?.page_id, task.page_id);
}

assert.equal(mirrorById.get("B2")?.title, "確認轉換點＝115學年末（情境A）");
assert.equal(mirrorById.get("B2")?.notion_title, "[B2] 確認轉換點＝115學年末（情境A）");
assert.equal(mirrorById.get("B3")?.title, "家長溝通方案＋通知信/說明會");
assert.equal(mirrorById.get("B3")?.notion_title, "[B3] 家長溝通方案＋通知信/說明會");

const remainingConflicts = computeConflicts(snapshot.tasks, mcMirror.tasks);
assert.deepEqual(remainingConflicts, [], "MC mirror must match Notion coded tasks after reconcile");

assert.match(report, /# KJ-LIVE-03 Mirror Reconcile Report/);
assert.match(report, /Notion \| source of truth \| 43/);
assert.match(report, /MC tasks\.json \| mirror \| 43/);
assert.match(report, /Heptabase \| mirror \/ 思考白板 \|/);
assert.match(report, /PAI 行動庫 \| legacy mirror \|/);
assert.match(report, /KJ-LIVE-01 snapshot recorded MC mirror count: 18/);
assert.match(report, /KJ-LIVE-01 snapshot recorded drift items: 25/);
assert.match(report, /B2 snapshot drift: Notion = \[B2\] 確認轉換點＝115學年末（情境A）; MC = 家長溝通方案（國二三轉換）/);
assert.match(report, /B3 snapshot drift: MC missing Notion task \[B3\] 家長溝通方案＋通知信\/說明會/);
assert.match(report, /B2.*確認轉換點＝115學年末（情境A）/s);
assert.match(report, /B3.*家長溝通方案＋通知信\/說明會/s);
assert.match(report, /沒有寫入 Notion、Heptabase 或 PAI/);
assert.match(report, /Heptabase\/PAI 寫入需 Vincent 明確確認/);

assert.ok(heptabaseNotionState.kj?.["雙語班"], "Heptabase Notion mirror state should retain KJ bilingual entry");
assert.ok(heptabasePaiState.KJ?.["KJ-自辦雙語班"], "PAI mirror state should retain KJ bilingual entry");
assert.match(kjAgents, /\[B2\] 確認轉換點＝115學年末（情境 A）/);
assert.match(kjAgents, /\[B3\] 家長溝通方案＋通知信\/說明會/);
assert.match(kjAgents, /Notion -> MC tasks\.json -> Heptabase \/ other mirrors/);

console.log(
  `KJ mirror reconcile OK: ${mcMirror.tasks.length} MC mirror tasks align with ${snapshot.summary.total_tasks} Notion rows; B2/B3 verified.`,
);

function stripTaskKey(title) {
  return String(title).replace(/^\[[^\]]+\]\s*/, "");
}

function computeConflicts(notionTasks, mirrorTasks) {
  const mirror = new Map(mirrorTasks.map((task) => [task.id, task]));
  return notionTasks
    .filter((task) => /^[A-FM]\d+$/.test(task.task_key))
    .flatMap((task) => {
      const mirrorTask = mirror.get(task.task_key);
      if (!mirrorTask) return [`missing:${task.task_key}`];
      const expectedTitle = stripTaskKey(task.title);
      if (mirrorTask.title !== expectedTitle) return [`title:${task.task_key}`];
      return [];
    });
}
