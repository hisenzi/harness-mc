import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const snapshotPath = path.join(root, "system-workflow/snapshots/kj-notion-tasks-snapshot.json");
const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));

assert.equal(snapshot.task_anchor, "morrowise/KJ-LIVE-01");
assert.equal(snapshot.source_of_truth.system, "Notion");
assert.equal(snapshot.source_of_truth.project_page_id, "381714fb14c680c1b93ec57136e95eec");
assert.equal(snapshot.source_of_truth.database_id, "eb0eddd212e44deaaffbb5d6da6a1be6");
assert.equal(snapshot.source_of_truth.data_source_id, "f046f40f-ac75-41ed-afa8-67379159316c");
assert.equal(snapshot.source_of_truth.data_source_url, "collection://f046f40f-ac75-41ed-afa8-67379159316c");

assert.ok(Array.isArray(snapshot.legacy_sources_not_authoritative));
assert.ok(
  snapshot.legacy_sources_not_authoritative.some((source) => source.data_source_id === "40060100-ba5d-4905-b37d-d5f821602da9"),
  "legacy KJ data source must be explicitly marked non-authoritative",
);

for (const key of ["generated_at", "notion_database", "project", "tasks", "summary", "known_conflicts"]) {
  assert.ok(Object.hasOwn(snapshot, key), key + " required");
}

for (const key of ["item", "type", "status", "workstream", "owner", "target_start", "target_end", "key_gate", "blocker", "description"]) {
  assert.ok(snapshot.notion_database.schema.properties[key], "schema missing " + key);
}

assert.equal(snapshot.tasks.length, 43, "Notion KJ 行動庫 snapshot should currently contain 43 rows");
assert.equal(snapshot.summary.total_tasks, snapshot.tasks.length);

const byStatus = countBy(snapshot.tasks, "status");
const byType = countBy(snapshot.tasks, "type");
const byWorkstream = countBy(snapshot.tasks, "workstream");
assert.deepEqual(snapshot.summary.by_status, byStatus);
assert.deepEqual(snapshot.summary.by_type, byType);
assert.deepEqual(snapshot.summary.by_workstream, byWorkstream);

const tasksByKey = new Map(snapshot.tasks.map((task) => [task.task_key, task]));
assert.equal(tasksByKey.get("B2")?.title, "[B2] 確認轉換點＝115學年末（情境A）");
assert.equal(tasksByKey.get("B3")?.title, "[B3] 家長溝通方案＋通知信/說明會");
assert.equal(snapshot.summary.b2_title, "[B2] 確認轉換點＝115學年末（情境A）");
assert.equal(snapshot.summary.b3_title, "[B3] 家長溝通方案＋通知信/說明會");

assert.ok(
  snapshot.known_conflicts.some((conflict) => conflict.type === "title_mismatch" && conflict.task_id === "B2"),
  "B2 MC mirror title mismatch must be detected",
);
assert.ok(
  snapshot.known_conflicts.some((conflict) => conflict.type === "notion_task_missing_in_mc_mirror" && conflict.task_id === "B3"),
  "B3 missing from MC mirror must be detected",
);

assert.ok(snapshot.write_boundary.forbidden.includes("write Notion"));
assert.ok(snapshot.write_boundary.forbidden.includes("read or store secrets/tokens"));
assert.ok(snapshot.next_actions.some((action) => action.task === "KJ-LIVE-02"));
assert.ok(snapshot.next_actions.some((action) => action.task === "KJ-LIVE-03"));

console.log(
  "KJ Notion read model OK: " + snapshot.tasks.length + " tasks, " + snapshot.known_conflicts.length + " known conflicts, B2/B3 verified.",
);

function countBy(items, key) {
  return items.reduce((acc, item) => {
    const value = item[key] ?? "null";
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}
