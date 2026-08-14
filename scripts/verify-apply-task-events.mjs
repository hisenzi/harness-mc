import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyTaskEvents } from "./apply-task-events.mjs";

const selectiveRoot = fs.mkdtempSync(path.join(os.tmpdir(), "apply-task-events-selective-"));
const selectiveProjectDir = path.join(selectiveRoot, "milestones", "demo-project");
const selectivePendingDir = path.join(selectiveRoot, "task-events", "pending");
const selectiveScriptsDir = path.join(selectiveRoot, "scripts");
fs.mkdirSync(selectiveProjectDir, { recursive: true });
fs.mkdirSync(selectivePendingDir, { recursive: true });
fs.mkdirSync(selectiveScriptsDir, { recursive: true });
fs.writeFileSync(path.join(selectiveScriptsDir, "generate-data.mjs"), "");
writeJson(path.join(selectiveProjectDir, "tasks.json"), {
  tasks: [
    { id: "task-1", title: "Selected task", status: "todo" },
    { id: "task-2", title: "Preserved task", status: "todo" },
  ],
});
writeJson(path.join(selectivePendingDir, "001-selected.json"), {
  event_id: "evt-select-one",
  type: "task.commit_attached",
  repo: "demo-repo",
  commit: "sel1111",
  project: "demo-project",
  task_id: "task-1",
  summary: "Only this closeout event should apply.",
  created_at: "2026-07-27T09:00:00+08:00",
  actor: "codex",
  session_id: "session-selective",
});
writeJson(path.join(selectivePendingDir, "002-preserved.json"), {
  event_id: "evt-preserve-two",
  type: "task.commit_attached",
  repo: "demo-repo",
  commit: "pre2222",
  project: "demo-project",
  task_id: "task-2",
  summary: "This unrelated pending event must remain untouched.",
  created_at: "2026-07-27T09:01:00+08:00",
  actor: "codex",
  session_id: "session-selective",
});
const selectiveResult = spawnSync(
  process.execPath,
  [fileURLToPath(new URL("./apply-task-events.mjs", import.meta.url)), "--event-id", "evt-select-one"],
  { cwd: selectiveRoot, encoding: "utf8" },
);
assert.equal(selectiveResult.status, 0, selectiveResult.stderr || selectiveResult.stdout);
assert.deepEqual(fs.readdirSync(selectivePendingDir), ["002-preserved.json"]);
assert.deepEqual(fs.readdirSync(path.join(selectiveRoot, "task-events", "applied")), ["001-selected.json"]);
const selectiveState = JSON.parse(fs.readFileSync(path.join(selectiveProjectDir, "state.json"), "utf8"));
assert.deepEqual(selectiveState.tasks["task-1"].commits, ["sel1111"]);
assert.equal(Object.hasOwn(selectiveState.tasks, "task-2"), false);

const coordinationRoot = fs.mkdtempSync(path.join(os.tmpdir(), "apply-task-events-coordination-"));
const coordinationProjectDir = path.join(coordinationRoot, "milestones", "morrowise");
const coordinationPendingDir = path.join(coordinationRoot, "task-events", "pending");
fs.mkdirSync(coordinationProjectDir, { recursive: true });
fs.mkdirSync(coordinationPendingDir, { recursive: true });
writeJson(path.join(coordinationProjectDir, "tasks.json"), {
  tasks: [{ id: "jv37", title: "Repo coordination", status: "todo" }],
});
const claimA = {
  claim_id: "claim-a",
  repo_class: "shared_core_multi_writer",
  branch: "main",
  base_sha: "a".repeat(40),
  claimed_at: "2026-08-12T01:00:00Z",
  owner_role: "integrator",
  actor: "codex",
  session_id: "session-jv37",
  remote_claim_ref: "refs/jv37/claims/morrowise/jv37",
  remote_claim_sha: "1".repeat(40),
  remote_state: "claimed",
};
const claimB = { ...claimA, claim_id: "claim-b", session_id: "session-jv37-b" };
const coordinationBase = {
  repo: "harness-mc",
  project: "morrowise",
  task_id: "jv37",
  actor: "codex",
  session_id: "session-jv37",
};
writeJson(path.join(coordinationPendingDir, "001-claim-a.json"), {
  ...coordinationBase,
  event_id: "evt-claim-a",
  type: "task.claimed",
  summary: "Claim A",
  created_at: "2026-08-12T01:00:00Z",
  coordination: claimA,
});
writeJson(path.join(coordinationPendingDir, "002-claim-b.json"), {
  ...coordinationBase,
  session_id: claimB.session_id,
  event_id: "evt-claim-b",
  type: "task.claimed",
  summary: "Conflicting Claim B",
  created_at: "2026-08-12T01:00:01Z",
  coordination: claimB,
});
writeJson(path.join(coordinationPendingDir, "003-remote.json"), {
  ...coordinationBase,
  event_id: "evt-remote-a",
  type: "task.remote_synced",
  commit: "abc1234",
  summary: "C1 reached remote",
  created_at: "2026-08-12T01:01:00Z",
  coordination: {
    ...claimA,
    remote_claim_sha: "2".repeat(40),
    remote_state: "c1_remote_synced",
  },
});
writeJson(path.join(coordinationPendingDir, "004-complete.json"), {
  ...coordinationBase,
  event_id: "evt-complete-a",
  type: "task.completed",
  commit: "def5678",
  summary: "Canonical apply by the active integrator",
  created_at: "2026-08-12T01:01:30Z",
  coordination: {
    ...claimA,
    remote_claim_sha: "3".repeat(40),
    remote_state: "canonical_applied",
  },
});
writeJson(path.join(coordinationPendingDir, "005-release.json"), {
  ...coordinationBase,
  event_id: "evt-release-a",
  type: "task.released",
  summary: "Claim released after terminal closeout",
  created_at: "2026-08-12T01:02:00Z",
  coordination: {
    ...claimA,
    remote_claim_sha: "4".repeat(40),
    remote_state: "released",
  },
});
const coordinationReport = applyTaskEvents({
  root: coordinationRoot,
  runGenerateData: false,
  writeLatestReport: false,
  coordinationProofVerifier: ({ event, expectedState }) => event.coordination?.remote_state === expectedState
    ? { decision: "READY" }
    : { decision: "BLOCKED", reason: "remote_claim_proof_mismatch" },
});
assert.deepEqual(coordinationReport.applied.map((item) => item.type), ["task.claimed", "task.remote_synced", "task.completed", "task.released"]);
assert.equal(coordinationReport.rejected.find((item) => item.event_id === "evt-claim-b").reason, "claim_conflict");
const coordinationState = JSON.parse(fs.readFileSync(path.join(coordinationProjectDir, "state.json"), "utf8"));
assert.equal(coordinationState.tasks.jv37.coordination.active_claim, null);
assert.equal(coordinationState.tasks.jv37.coordination.last_release.claim_id, "claim-a");
assert.deepEqual(coordinationState.tasks.jv37.commits, ["abc1234", "def5678"]);

const lockDir = path.join(coordinationRoot, "task-events", ".jv37-apply.lock");
fs.mkdirSync(lockDir);
assert.throws(
  () => applyTaskEvents({ root: coordinationRoot, runGenerateData: false }),
  /task_event_apply_locked/,
);
fs.rmdirSync(lockDir);

const preservedReportPath = path.join(selectiveRoot, "task-events", "latest-report.json");
const preservedReport = '{\n  "owner": "another-session"\n}\n';
fs.writeFileSync(preservedReportPath, preservedReport);
writeJson(path.join(selectivePendingDir, "003-no-report-overwrite.json"), {
  event_id: "evt-no-report-overwrite",
  type: "task.commit_attached",
  repo: "demo-repo",
  commit: "sel3333",
  project: "demo-project",
  task_id: "task-1",
  summary: "Exact apply must preserve another session's dirty latest report.",
  created_at: "2026-07-27T09:02:00+08:00",
  actor: "codex",
  session_id: "session-selective",
});
const noOverwriteResult = spawnSync(
  process.execPath,
  [
    fileURLToPath(new URL("./apply-task-events.mjs", import.meta.url)),
    "--event-id",
    "evt-no-report-overwrite",
    "--no-generate-data",
    "--no-latest-report",
  ],
  { cwd: selectiveRoot, encoding: "utf8" },
);
assert.equal(noOverwriteResult.status, 0, noOverwriteResult.stderr || noOverwriteResult.stdout);
assert.equal(fs.readFileSync(preservedReportPath, "utf8"), preservedReport);
assert.deepEqual(fs.readdirSync(selectivePendingDir), ["002-preserved.json"]);

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "apply-task-events-"));
const crashRoot = fs.mkdtempSync(path.join(os.tmpdir(), "apply-task-events-crash-recovery-"));
fs.mkdirSync(path.join(crashRoot, "milestones", "crash-project"), { recursive: true });
fs.mkdirSync(path.join(crashRoot, "task-events", "pending"), { recursive: true });
writeJson(path.join(crashRoot, "milestones", "crash-project", "tasks.json"), {
  tasks: [{ id: "crash-task", title: "Crash recovery task", status: "todo" }],
});
writeJson(path.join(crashRoot, "task-events", "pending", "001-crash.json"), {
  event_id: "evt-crash-after-state",
  type: "task.completed",
  repo: "crash-repo",
  commit: "c100000",
  project: "crash-project",
  task_id: "crash-task",
  summary: "Crash after durable state before event move.",
  created_at: "2026-08-12T02:00:00Z",
  actor: "codex",
  session_id: "crash-session",
});
const crashModuleUrl = new URL("./apply-task-events.mjs", import.meta.url).href;
const crashedProcess = spawnSync(process.execPath, [
  "--input-type=module",
  "-e",
  `import { applyTaskEvents } from ${JSON.stringify(crashModuleUrl)}; applyTaskEvents({ root: process.argv[1], runGenerateData: false, afterStatePersisted: () => process.kill(process.pid, "SIGKILL") });`,
  crashRoot,
], { encoding: "utf8" });
assert.equal(crashedProcess.signal, "SIGKILL", crashedProcess.stderr || crashedProcess.stdout);
assert.equal(JSON.parse(fs.readFileSync(path.join(crashRoot, "milestones", "crash-project", "state.json"), "utf8")).tasks["crash-task"].status, "completed");
assert.equal(fs.readdirSync(path.join(crashRoot, "task-events", "pending")).length, 1);
assert.equal(fs.readdirSync(path.join(crashRoot, "task-events", "transactions")).length, 1);
assert.equal(fs.readdirSync(path.join(crashRoot, "sync-events", "pending")).length, 1);
assert.equal(fs.existsSync(path.join(crashRoot, "task-events", ".jv37-apply.lock", "owner.json")), true);
const recoveredCrash = applyTaskEvents({ root: crashRoot, runGenerateData: false });
assert.deepEqual(recoveredCrash.applied.map((item) => [item.event_id, item.recovered]), [["evt-crash-after-state", true]]);
assert.equal(fs.readdirSync(path.join(crashRoot, "task-events", "pending")).length, 0);
assert.equal(fs.readdirSync(path.join(crashRoot, "task-events", "transactions")).length, 0);
assert.equal(fs.readdirSync(path.join(crashRoot, "task-events", "applied")).length, 1);
assert.equal(fs.readdirSync(path.join(crashRoot, "sync-events", "pending")).length, 1, "recovery must not duplicate an already enqueued sync event");
assert.equal(fs.readdirSync(path.join(crashRoot, "task-events", "stale-locks")).length, 1, "dead lock must be preserved as recoverable evidence");
const manualRejectionReview = {
  approved_by: "Vincent",
  approved_at: "2026-07-19",
  evidence_refs: ["current-session: Vincent approved reviewed event application"],
};

const missingReviewRoot = fs.mkdtempSync(path.join(os.tmpdir(), "apply-task-events-missing-review-"));
fs.mkdirSync(path.join(missingReviewRoot, "milestones", "demo-project"), { recursive: true });
fs.mkdirSync(path.join(missingReviewRoot, "task-events", "pending"), { recursive: true });
writeJson(path.join(missingReviewRoot, "milestones", "demo-project", "tasks.json"), {
  tasks: [{ id: "task-1", title: "Review gate fixture", status: "todo" }],
});
writeJson(path.join(missingReviewRoot, "task-events", "pending", "001-manual-reject.json"), {
  event_id: "evt-review-required",
  type: "task.commit_attached",
  repo: "demo-repo",
  commit: "bad0000",
  project: "demo-project",
  task_id: "task-1",
  summary: "Manual rejection must carry approval evidence.",
  created_at: "2026-07-19T09:00:00+08:00",
  actor: "codex",
  session_id: "session-review",
});
assert.throws(
  () => applyTaskEvents({
    root: missingReviewRoot,
    runGenerateData: false,
    manualRejections: new Map([["evt-review-required", "wrong_task_owner"]]),
  }),
  /manual rejection requires explicit Vincent approval evidence/,
);
assert.equal(fs.readdirSync(path.join(missingReviewRoot, "task-events", "pending")).length, 1, "missing review evidence must fail before moving events");

const projectDir = path.join(tmpRoot, "milestones", "demo-project");
const pendingDir = path.join(tmpRoot, "task-events", "pending");
fs.mkdirSync(projectDir, { recursive: true });
fs.mkdirSync(pendingDir, { recursive: true });

writeJson(path.join(projectDir, "tasks.json"), {
  tasks: [
    {
      id: "task-1",
      title: "First task",
      status: "in_progress",
      commits: ["old1111"],
      external_refs: {
        heptabase: {
          whiteboard: "MC 儀表版",
          card_id: "card-task-1",
        },
      },
    },
    {
      id: "task-2",
      title: "Second task",
      status: "completed",
      completed_at: "2026-06-01",
      commits: [],
    },
    {
      id: "task-3",
      title: "Third task",
      status: "todo",
    },
    {
      id: "task-4",
      title: "Untouched task with legacy state metadata",
      status: "todo",
    },
    {
      id: "task-5",
      title: "Untouched task without state",
      status: "todo",
    },
  ],
});

writeJson(path.join(projectDir, "state.json"), {
  tasks: {
    "task-4": {
      status: "todo",
      note: "This unrelated legacy state metadata must remain byte-equivalent.",
    },
  },
});

writeEvent("001-complete.json", {
  event_id: "evt-complete-task-1",
  type: "task.completed",
  repo: "demo-repo",
  commit: "abc1234",
  project: "demo-project",
  task_id: "task-1",
  summary: "Task 1 completed.",
  created_at: "2026-06-15T09:00:00+08:00",
  actor: "codex",
  session_id: "session-1",
});

writeEvent("002-duplicate.json", {
  event_id: "evt-complete-task-1",
  type: "task.completed",
  repo: "demo-repo",
  commit: "abc1234",
  project: "demo-project",
  task_id: "task-1",
  summary: "Duplicate event should not apply twice.",
  created_at: "2026-06-15T09:01:00+08:00",
  actor: "codex",
  session_id: "session-1",
});

writeEvent("003-reopen.json", {
  event_id: "evt-reopen-task-2",
  type: "task.reopened",
  repo: "demo-repo",
  commit: "def5678",
  project: "demo-project",
  task_id: "task-2",
  summary: "Task 2 reopened.",
  created_at: "2026-06-15T10:00:00+08:00",
  actor: "codex",
  session_id: "session-2",
});

writeEvent("004-blocked.json", {
  event_id: "evt-block-task-3",
  type: "task.blocked",
  repo: "demo-repo",
  commit: "fed4321",
  project: "demo-project",
  task_id: "task-3",
  summary: "Task 3 blocked.",
  created_at: "2026-06-15T11:00:00+08:00",
  actor: "codex",
  session_id: "session-3",
});

writeEvent("005-commit-attached.json", {
  event_id: "evt-attach-task-3",
  type: "task.commit_attached",
  repo: "demo-repo",
  commit: "bee9999",
  project: "demo-project",
  task_id: "task-3",
  summary: "Attach commit without status change.",
  created_at: "2026-06-15T11:30:00+08:00",
  actor: "codex",
  session_id: "session-3",
});

writeEvent("006-unknown-task.json", {
  event_id: "evt-unknown-task",
  type: "task.completed",
  repo: "demo-repo",
  commit: "bad0001",
  project: "demo-project",
  task_id: "missing-task",
  summary: "Unknown task should reject.",
  created_at: "2026-06-15T12:00:00+08:00",
  actor: "codex",
  session_id: "session-4",
});

writeEvent("007-unknown-type.json", {
  event_id: "evt-unknown-type",
  type: "task.archived",
  repo: "demo-repo",
  commit: "bad0002",
  project: "demo-project",
  task_id: "task-1",
  summary: "Unknown type should reject.",
  created_at: "2026-06-15T12:30:00+08:00",
  actor: "codex",
  session_id: "session-5",
});

writeEvent("008-unknown-project.json", {
  event_id: "evt-unknown-project",
  type: "task.completed",
  repo: "demo-repo",
  commit: "bad0003",
  project: "missing-project",
  task_id: "task-1",
  summary: "Unknown project should reject without crashing.",
  created_at: "2026-06-15T13:00:00+08:00",
  actor: "codex",
  session_id: "session-6",
});

writeEvent("009-manual-reject.json", {
  event_id: "evt-wrong-task-owner",
  type: "task.commit_attached",
  repo: "demo-repo",
  commit: "bad0004",
  project: "demo-project",
  task_id: "task-3",
  summary: "A reviewer found that this commit belongs to another task.",
  created_at: "2026-06-15T14:00:00+08:00",
  actor: "codex",
  session_id: "session-7",
});

assert.throws(
  () => applyTaskEvents({
    root: tmpRoot,
    runGenerateData: false,
    manualRejections: new Map([["evt-misspelled-owner", "wrong_task_owner"]]),
    manualRejectionReview,
  }),
  /manual rejection event_id not found in pending queue: evt-misspelled-owner/,
);
assert.equal(fs.readdirSync(pendingDir).length, 9, "unmatched manual rejection must fail before moving any event");
assert.equal(fs.readdirSync(path.join(tmpRoot, "task-events", "applied")).length, 0, "unmatched manual rejection must not apply events");
assert.equal(fs.readdirSync(path.join(tmpRoot, "task-events", "rejected")).length, 0, "unmatched manual rejection must not reject events");

const report = applyTaskEvents({
  root: tmpRoot,
  runGenerateData: false,
  manualRejections: new Map([["evt-wrong-task-owner", "wrong_task_owner"]]),
  manualRejectionReview,
});

assert.equal(report.applied.length, 4);
assert.equal(report.rejected.length, 5);
assert.equal(report.duplicates.length, 1);
assert.equal(report.rejected.find((item) => item.event_id === "evt-unknown-task").reason, "unknown_task");
assert.equal(report.rejected.find((item) => item.event_id === "evt-unknown-type").reason, "unknown_type");
assert.equal(report.rejected.find((item) => item.event_id === "evt-unknown-project").reason, "unknown_task");
assert.equal(report.rejected.find((item) => item.event_id === "evt-wrong-task-owner").reason, "wrong_task_owner");
const manualRejectionRecord = JSON.parse(fs.readFileSync(path.join(tmpRoot, "task-events", "rejected", "009-manual-reject.json"), "utf8"));
assert.deepEqual(manualRejectionRecord.manual_review, manualRejectionReview);

const definitionsAfterApply = JSON.parse(fs.readFileSync(path.join(projectDir, "tasks.json"), "utf8"));
assert.equal(definitionsAfterApply.tasks.find((task) => task.id === "task-1").status, "in_progress");
assert.equal(definitionsAfterApply.tasks.find((task) => task.id === "task-2").status, "completed");
assert.equal(definitionsAfterApply.tasks.find((task) => task.id === "task-3").status, "todo");

const state = JSON.parse(fs.readFileSync(path.join(projectDir, "state.json"), "utf8"));
const task1 = state.tasks["task-1"];
const task2 = state.tasks["task-2"];
const task3 = state.tasks["task-3"];
const task4 = state.tasks["task-4"];

assert.equal(task1.status, "completed");
assert.equal(task1.completed_at, "2026-06-15");
assert.deepEqual(task1.commits, ["old1111", "abc1234"]);

assert.equal(task2.status, "in_progress");
assert.equal(task2.completed_at, undefined);
assert.deepEqual(task2.commits, ["def5678"]);

assert.equal(task3.status, "blocked");
assert.deepEqual(task3.commits, ["fed4321", "bee9999"]);
assert.deepEqual(task4, {
  status: "todo",
  note: "This unrelated legacy state metadata must remain byte-equivalent.",
});
assert.equal(Object.hasOwn(state.tasks, "task-5"), false, "untouched task without state must not be auto-added");

assert.deepEqual(fs.readdirSync(pendingDir), []);
assert.equal(fs.readdirSync(path.join(tmpRoot, "task-events", "applied")).length, 4);
assert.equal(fs.readdirSync(path.join(tmpRoot, "task-events", "rejected")).length, 5);

const reportPath = path.join(tmpRoot, "task-events", "latest-report.json");
const writtenReport = JSON.parse(fs.readFileSync(reportPath, "utf8"));
assert.equal(writtenReport.applied.length, 4);
assert.equal(writtenReport.rejected.length, 5);
assert.equal(writtenReport.duplicates.length, 1);

const syncPendingDir = path.join(tmpRoot, "sync-events", "pending");
const syncFiles = fs.readdirSync(syncPendingDir).sort();
assert.equal(syncFiles.length, 6);

const syncEvents = syncFiles.map((fileName) => JSON.parse(fs.readFileSync(path.join(syncPendingDir, fileName), "utf8")));
assert.equal(syncEvents.filter((event) => event.target === "obsidian_canvas").length, 4);
assert.equal(syncEvents.filter((event) => event.target === "heptabase_append").length, 1);
assert.equal(syncEvents.filter((event) => event.target === "notion_sentinel").length, 1);
assert.equal(syncEvents.every((event) => event.type === "sync_requested"), true);
assert.equal(syncEvents.every((event) => event.status === "pending"), true);

console.log("apply-task-events verification passed");

function writeEvent(fileName, event) {
  writeJson(path.join(pendingDir, fileName), event);
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
