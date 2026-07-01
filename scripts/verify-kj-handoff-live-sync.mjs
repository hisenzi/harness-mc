import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const collabRoot = path.dirname(root);
const snapshotPath = path.join(root, "system-workflow/snapshots/kj-notion-tasks-snapshot.json");
const handoffPath = path.join(collabRoot, "CC本機協作_無Git/KJ/260612_KJ_雙語班/HANDOFF_260701.md");
const updateScriptPath = path.join(collabRoot, "CC本機協作_無Git/KJ/260612_KJ_雙語班/scripts/update-handoff.py");
const mcMirrorPath = path.join(root, "milestones/kj-bilingual/tasks.json");

const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
const handoff = fs.readFileSync(handoffPath, "utf8");
const updateScript = fs.readFileSync(updateScriptPath, "utf8");
const mcMirror = JSON.parse(fs.readFileSync(mcMirrorPath, "utf8"));

assert.equal(snapshot.task_anchor, "morrowise/KJ-LIVE-01");
assert.equal(snapshot.source_of_truth.system, "Notion");
assert.equal(snapshot.source_of_truth.data_source_id, "f046f40f-ac75-41ed-afa8-67379159316c");
assert.ok(
  snapshot.legacy_sources_not_authoritative.some((source) => source.data_source_id === "40060100-ba5d-4905-b37d-d5f821602da9"),
  "legacy data source must be marked non-authoritative",
);

assert.match(updateScript, /--check/, "update-handoff.py must expose --check mode");
assert.match(updateScript, /kj-notion-tasks-snapshot\.json/, "update-handoff.py must read the KJ-LIVE-01 snapshot");

const checkOutput = execFileSync("python3", [updateScriptPath, "--check"], {
  cwd: path.dirname(handoffPath),
  encoding: "utf8",
});
assert.match(checkOutput, /OK：HANDOFF live snapshot is current/);
assert.doesNotMatch(checkOutput, /已更新|write/i, "--check must not write files");

const section = extractSection(handoff, "<!-- kj-live-snapshot:start -->", "<!-- kj-live-snapshot:end -->");
assert.match(section, /來源 snapshot：`\$COLLAB\/harness-mc\/system-workflow\/snapshots\/kj-notion-tasks-snapshot\.json`/);
assert.match(section, /Source of Truth/);
assert.match(section, /Notion \| source of truth/);
assert.match(section, /MC tasks\.json \| mirror/);
assert.match(section, /Heptabase \| mirror \/ 思考白板/);
assert.match(section, /PAI 行動庫 \| 舊層/);

assert.match(section, /Data Source ID \| `f046f40f-ac75-41ed-afa8-67379159316c`/);
assert.doesNotMatch(section, /Data Source ID \| `40060100-ba5d-4905-b37d-d5f821602da9`/);
assert.match(section, /Notion 任務數：43/);
assert.match(section, /MC mirror 任務數：18/);
assert.match(section, /已知 drift：25/);

assert.match(section, /\[B2\] 確認轉換點＝115學年末（情境A）/);
assert.match(section, /\[B3\] 家長溝通方案＋通知信\/說明會/);
assert.match(section, /B2.*家長溝通方案（國二三轉換）/s);
assert.match(section, /B3.*MC mirror.*缺少/s);

const tasksById = new Map(mcMirror.tasks.map((task) => [task.id, task]));
assert.equal(tasksById.get("B2")?.title, "家長溝通方案（國二三轉換）");
assert.equal(tasksById.has("B3"), false);
assert.ok(
  snapshot.known_conflicts.some((conflict) => conflict.type === "title_mismatch" && conflict.task_id === "B2" && conflict.severity === "high"),
  "B2 title drift must stay detectable",
);
assert.ok(
  snapshot.known_conflicts.some((conflict) => conflict.type === "notion_task_missing_in_mc_mirror" && conflict.task_id === "B3"),
  "B3 missing drift must stay detectable",
);

const snapshotGeneratedAt = Date.parse(snapshot.generated_at);
assert.ok(Number.isFinite(snapshotGeneratedAt), "snapshot generated_at must parse");
const maxAgeMs = 14 * 24 * 60 * 60 * 1000;
assert.ok(Date.now() - snapshotGeneratedAt < maxAgeMs, "snapshot must be fresher than 14 days for handoff sync");

assert.match(section, /同步方向：`Notion -> MC tasks\.json -> Heptabase \/ PAI mirrors`/);
assert.match(section, /`--check` 不改檔/);

console.log(
  `KJ handoff live sync OK: snapshot ${snapshot.summary.total_tasks} Notion tasks, ${snapshot.summary.known_conflict_count} drift items, --check verified.`,
);

function extractSection(text, start, end) {
  const startIndex = text.indexOf(start);
  const endIndex = text.indexOf(end);
  assert.notEqual(startIndex, -1, `${start} marker missing`);
  assert.notEqual(endIndex, -1, `${end} marker missing`);
  assert.ok(endIndex > startIndex, "end marker must appear after start marker");
  return text.slice(startIndex, endIndex + end.length);
}
