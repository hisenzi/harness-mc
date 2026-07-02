import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const collabRoot = path.dirname(root);
const snapshotPath = path.join(root, "system-workflow/snapshots/kj-notion-tasks-snapshot.json");
const mcMirrorPath = path.join(root, "milestones/kj-bilingual/tasks.json");
const reportPath = path.join(root, "system-workflow/reports/kj-mirror-reconcile-report.md");
const heptabaseNotionStatePath = path.join(collabRoot, "notyet-harness/000_Agent/config/heptabase-notion-sync-state.json");
const heptabasePaiStatePath = path.join(collabRoot, "notyet-harness/000_Agent/config/heptabase-pai-sync-state.json");

const args = new Set(process.argv.slice(2));
const checkOnly = args.has("--check");

const snapshot = readJson(snapshotPath);
const currentMirror = readJson(mcMirrorPath);
const heptabaseNotionState = readJson(heptabaseNotionStatePath);
const heptabasePaiState = readJson(heptabasePaiStatePath);

const generatedAt = checkOnly
  ? currentMirror.mirror_status?.reconciled_at || new Date().toISOString()
  : new Date().toISOString();
const reconciled = buildMirror({ snapshot, currentMirror, generatedAt });
const report = buildReport({ snapshot, currentMirror, reconciled, heptabaseNotionState, heptabasePaiState, generatedAt });

if (checkOnly) {
  const currentReport = fs.existsSync(reportPath) ? fs.readFileSync(reportPath, "utf8") : "";
  const currentMirrorText = JSON.stringify(currentMirror, null, 2) + "\n";
  const nextMirrorText = JSON.stringify(reconciled, null, 2) + "\n";
  const changed = currentReport !== report || currentMirrorText !== nextMirrorText;
  if (changed) {
    console.error("KJ mirror reconcile check failed: generated output differs.");
    process.exit(1);
  }
  console.log("KJ mirror reconcile check OK: generated output is current.");
  process.exit(0);
}

fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(mcMirrorPath, JSON.stringify(reconciled, null, 2) + "\n");
fs.writeFileSync(reportPath, report);

console.log(
  `KJ mirror reconciled: ${reconciled.tasks.length} MC mirror tasks from ${snapshot.summary.total_tasks} Notion rows; report written to ${path.relative(root, reportPath)}.`,
);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function buildMirror({ snapshot, currentMirror, generatedAt }) {
  const existingById = new Map((currentMirror.tasks || []).map((task) => [task.id, task]));
  const tasks = snapshot.tasks.map((task) => toMirrorTask(task, existingById));
  return {
    project: "kj-bilingual",
    source_policy: "Notion -> MC tasks.json -> Heptabase / PAI mirrors",
    source_of_truth: {
      system: "Notion",
      project_page_id: snapshot.source_of_truth.project_page_id,
      database_id: snapshot.source_of_truth.database_id,
      data_source_id: snapshot.source_of_truth.data_source_id,
      snapshot: "$COLLAB/harness-mc/system-workflow/snapshots/kj-notion-tasks-snapshot.json",
    },
    mirror_status: {
      task_anchor: "morrowise/KJ-LIVE-03",
      reconciled_at: generatedAt,
      source_snapshot: "$COLLAB/harness-mc/system-workflow/snapshots/kj-notion-tasks-snapshot.json",
      source_snapshot_generated_at: snapshot.generated_at,
      direction: "Notion -> MC tasks.json",
      write_boundary: "No Notion, Heptabase, or PAI writes were performed.",
    },
    tasks,
  };
}

function toMirrorTask(task, existingById) {
  const id = /^[A-FM]\d+$/.test(task.task_key) ? task.task_key : `notion-${task.page_id.slice(-8)}`;
  const existing = existingById.get(id) || {};
  const mirrorTask = {
    id,
    title: stripTaskKey(task.title),
    notion_title: task.title,
    status: mapStatus(task.status),
    notion_status: task.status,
    type: task.type,
    track: mapTrack(task, existing.track),
    done_condition: task.description || `依 Notion 權威任務「${task.title}」追蹤完成。`,
    owner: task.owner || "待指定",
    target_date: formatTargetDate(task.target_date),
    key_gate: Boolean(task.key_gate),
    source_ref: {
      system: "Notion",
      page_id: task.page_id,
      url: task.notion_url,
      data_source_id: "f046f40f-ac75-41ed-afa8-67379159316c",
    },
    mirror_note: "Generated from KJ-LIVE-01 snapshot by KJ-LIVE-03; Notion remains source of truth.",
  };

  if (task.dependency_or_blocker) mirrorTask.blocker = task.dependency_or_blocker;
  if (Array.isArray(existing.depends_on) && existing.depends_on.length > 0) mirrorTask.depends_on = existing.depends_on;
  if (existing.note && !task.description) mirrorTask.note = existing.note;
  return mirrorTask;
}

function stripTaskKey(title) {
  return String(title).replace(/^\[[^\]]+\]\s*/, "");
}

function mapStatus(status) {
  return {
    "未開始": "todo",
    "進行中": "in_progress",
    "有風險": "blocked",
    "受阻": "blocked",
    "完成": "completed",
  }[status] || "todo";
}

function mapTrack(task, existingTrack) {
  if (existingTrack && /^[A-FM]\d+$/.test(task.task_key)) return existingTrack;
  return {
    "A交接": "A-handover",
    "B轉換": "B-transition",
    "C產品": "C-product",
    "D師資": "D-teacher",
    "E行銷": "E-marketing",
    "F合規": "F-compliance",
    "里程碑": "milestone",
  }[task.workstream] || "mirror";
}

function formatTargetDate(targetDate) {
  if (!targetDate || (!targetDate.start && !targetDate.end)) return null;
  if (targetDate.start && targetDate.end) return `${targetDate.start}..${targetDate.end}`;
  return targetDate.start || targetDate.end;
}

function buildReport({ snapshot, currentMirror, reconciled, heptabaseNotionState, heptabasePaiState, generatedAt }) {
  const before = compareSnapshotToMirror(snapshot.tasks, currentMirror.tasks || []);
  const after = compareSnapshotToMirror(snapshot.tasks, reconciled.tasks);
  const generationConflicts = snapshot.known_conflicts || [];
  const heptabaseTitle = "雙語班";
  const paiTitle = "KJ-自辦雙語班";
  const heptabaseCard = heptabaseNotionState.kj?.[heptabaseTitle] || "unknown";
  const paiCard = heptabasePaiState.KJ?.[paiTitle] || "unknown";

  return [
    "# KJ-LIVE-03 Mirror Reconcile Report",
    "",
    `- generated_at: ${generatedAt}`,
    "- task_anchor: morrowise/KJ-LIVE-03",
    "- source_snapshot: `$COLLAB/harness-mc/system-workflow/snapshots/kj-notion-tasks-snapshot.json`",
    `- snapshot_generated_at: ${snapshot.generated_at}`,
    "- direction: `Notion -> MC tasks.json -> Heptabase / PAI mirrors`",
    "- write_boundary: 沒有寫入 Notion、Heptabase 或 PAI；Heptabase/PAI 寫入需 Vincent 明確確認。",
    "",
    "## Layer Summary",
    "",
    "| Layer | Role | Count / Evidence | Status |",
    "|---|---|---:|---|",
    `| Notion | source of truth | ${snapshot.summary.total_tasks} | authoritative snapshot |`,
    `| MC tasks.json | mirror | ${reconciled.tasks.length} | reconciled from Notion snapshot |`,
    `| Heptabase | mirror / 思考白板 | ${heptabaseTitle} -> ${heptabaseCard} | local sync-state only; no write performed |`,
    `| PAI 行動庫 | legacy mirror | ${paiTitle} -> ${paiCard} | local sync-state only; no write performed |`,
    "",
    "## Before Reconcile",
    "",
    "### Generation-Time Drift Evidence",
    "",
    `- KJ-LIVE-01 snapshot recorded MC mirror count: ${snapshot.summary.mc_mirror_count}`,
    `- KJ-LIVE-01 snapshot recorded drift items: ${generationConflicts.length}`,
    `- B2 snapshot drift: ${formatSnapshotConflict(generationConflicts, "B2")}`,
    `- B3 snapshot drift: ${formatSnapshotConflict(generationConflicts, "B3")}`,
    "",
    "### Current Input At This Run",
    "",
    `- MC mirror count: ${(currentMirror.tasks || []).length}`,
    `- Notion coded tasks missing in MC: ${before.missing.length}`,
    `- Notion/MC title mismatches: ${before.titleMismatches.length}`,
    `- MC extra coded tasks: ${before.extra.length}`,
    "",
    "### High-Impact B-Line Drift",
    "",
    `- B2 before: ${findTitle(currentMirror.tasks || [], "B2") || "missing"}`,
    "- B2 Notion: [B2] 確認轉換點＝115學年末（情境A）",
    `- B3 before: ${findTitle(currentMirror.tasks || [], "B3") || "missing"}`,
    "- B3 Notion: [B3] 家長溝通方案＋通知信/說明會",
    "",
    "## After Reconcile",
    "",
    `- MC mirror count: ${reconciled.tasks.length}`,
    `- Remaining Notion coded tasks missing in MC: ${after.missing.length}`,
    `- Remaining Notion/MC title mismatches: ${after.titleMismatches.length}`,
    `- Remaining MC extra coded tasks: ${after.extra.length}`,
    `- B2 after: ${findTitle(reconciled.tasks, "B2")}`,
    `- B3 after: ${findTitle(reconciled.tasks, "B3")}`,
    "",
    "## Mirror Policy",
    "",
    "- Notion remains source of truth for task title, status, owner, target date, and description.",
    "- MC tasks.json is an agent execution mirror generated from the KJ-LIVE-01 snapshot.",
    "- Heptabase/PAI are listed as mirror evidence only in this slice; no external write was performed.",
    "- If Heptabase/PAI content must be updated, run a separate approval-gated sync after Vincent confirms the exact target.",
    "",
  ].join("\n");
}

function compareSnapshotToMirror(notionTasks, mirrorTasks) {
  const codedNotion = notionTasks.filter((task) => /^[A-FM]\d+$/.test(task.task_key));
  const mirrorById = new Map(mirrorTasks.map((task) => [task.id, task]));
  const notionIds = new Set(codedNotion.map((task) => task.task_key));
  return {
    missing: codedNotion.filter((task) => !mirrorById.has(task.task_key)).map((task) => task.task_key),
    titleMismatches: codedNotion
      .filter((task) => mirrorById.has(task.task_key) && mirrorById.get(task.task_key).title !== stripTaskKey(task.title))
      .map((task) => task.task_key),
    extra: mirrorTasks.filter((task) => /^[A-FM]\d+$/.test(task.id) && !notionIds.has(task.id)).map((task) => task.id),
  };
}

function findTitle(tasks, id) {
  const task = tasks.find((item) => item.id === id);
  return task ? task.title : null;
}

function formatSnapshotConflict(conflicts, taskId) {
  const conflict = conflicts.find((item) => item.task_id === taskId);
  if (!conflict) return "none";
  if (conflict.type === "title_mismatch") {
    return `Notion = ${conflict.notion_title}; MC = ${conflict.mc_title}`;
  }
  if (conflict.type === "notion_task_missing_in_mc_mirror") {
    return `MC missing Notion task ${conflict.notion_title}`;
  }
  return conflict.type;
}
