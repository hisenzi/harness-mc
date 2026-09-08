import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { formatMarkdown, runPreflight } from "./work-anchor-preflight.mjs";

const root = path.resolve(import.meta.dirname, "..");
const executionSkill = fs.readFileSync(
  path.resolve(root, "..", "notyet-harness", "000_Agent", "skills", "vincent-superpowers", "03-execution", "SKILL.md"),
  "utf8",
);
const reviewSkill = fs.readFileSync(
  path.resolve(root, "..", "notyet-harness", "000_Agent", "skills", "review", "SKILL.md"),
  "utf8",
);

for (const phrase of [
  "--event acceptance",
  "--matrix-fingerprint",
  "--acceptance-result",
  "acceptance_receipt",
]) {
  assert.ok(executionSkill.includes(phrase), `execution skill missing acceptance contract phrase: ${phrase}`);
}
for (const phrase of [
  "--event acceptance",
  "task.acceptance_matrix",
  "acceptance_receipt",
]) {
  assert.ok(reviewSkill.includes(phrase), `review skill missing acceptance contract phrase: ${phrase}`);
}
for (const source of [executionSkill, reviewSkill]) {
  assert.match(source, /version: ["']?\d+\.\d+/, 'skills must remain versioned');
  assert.ok(source.includes('morrowise-workbook-flow.md'), 'explicit workbook route must point to its shared contract');
}

const allowResult = runPreflight({
  project: "house123-buy",
  tasks: path.join(root, "milestones", "house123-buy", "tasks.json"),
  intent: "開始",
  proposedAcceptance: [],
});

assert.equal(allowResult.decision, "allow");
assert.equal(allowResult.active_task.id, "post-approval-loan-strategy-simulator");
assert.equal(allowResult.existing_task_state.active, 1);

const original = JSON.parse(
  fs.readFileSync(path.join(root, "milestones", "house123-buy", "tasks.json"), "utf-8"),
);
const historicalFixture = {
  tasks: original.tasks.filter((task) => task.id !== "post-approval-loan-strategy-simulator"),
};
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "work-anchor-preflight-"));
const fixturePath = path.join(tmpDir, "tasks.json");
fs.writeFileSync(fixturePath, JSON.stringify(historicalFixture, null, 2), "utf-8");

const blockedResult = runPreflight({
  project: "house123-buy",
  tasks: fixturePath,
  intent: "可以",
  proposedId: "post-approval-loan-strategy-simulator",
  proposedTitle: "核貸後決策系統：核准條件試算 + 四軸風險評分 + 推薦方案",
  proposedTrack: "dev",
  proposedDoneCondition: "新增核貸後決策流程，並把試算、風險評分、推薦方案整合到摘要/PDF。",
  proposedAcceptance: [
    "列出核准條件輸入、月付/總利息試算、四軸風險評分與推薦方案。",
  ],
});

assert.equal(blockedResult.decision, "blocked");
assert.equal(blockedResult.existing_task_state.active, 0);
assert.equal(blockedResult.existing_task_state.done, historicalFixture.tasks.length);
assert.equal(blockedResult.proposed_task.complete, true);
assert.equal(blockedResult.proposed_task.task.id, "post-approval-loan-strategy-simulator");
assert.match(blockedResult.next_required_step, /確認 proposed task/);
assert.match(blockedResult.next_required_step, /開始改檔/);
assert.equal(
  "active_task" in blockedResult && blockedResult.active_task === null,
  true,
  "blocked preflight must not expose an active task that would allow implementation",
);

const quickProjectDir = path.join(tmpDir, "visual-template-system");
const quickTasksPath = path.join(quickProjectDir, "tasks.json");
fs.mkdirSync(quickProjectDir, { recursive: true });
fs.writeFileSync(
  path.join(quickProjectDir, "project.json"),
  JSON.stringify({
    name: "視覺模板系統",
    project_code: "VTS",
  }, null, 2),
  "utf-8",
);
fs.writeFileSync(
  quickTasksPath,
  JSON.stringify({
    tasks: [
      {
        id: "blocked-mvp-task",
        title: "目前被阻擋的 MVP 任務",
        status: "blocked",
        track: "mvp",
        order_label: "VTS-MVP-02",
        done_condition: "阻擋解除後才能執行。",
      },
      {
        id: "later-mvp-task",
        title: "稍後執行的 MVP 任務",
        status: "todo",
        track: "mvp",
        order_label: "VTS-MVP-04",
        done_condition: "指定的稍後任務可以被明確選取。",
      },
      {
        id: "first-mvp-task",
        title: "最先執行的 MVP 任務",
        status: "todo",
        track: "mvp",
        order_label: "VTS-MVP-03",
        done_condition: "未指定 task-id 時先選擇此任務。",
      },
    ],
  }, null, 2),
  "utf-8",
);

const quickDefaultResult = runPreflight({
  project: "visual-template-system",
  tasks: quickTasksPath,
  intent: "開始 MVP",
  proposedAcceptance: [],
});
assert.equal(quickDefaultResult.active_task.id, "first-mvp-task");
assert.equal(quickDefaultResult.active_task.order_label, "VTS-MVP-03");
assert.equal(quickDefaultResult.ordering_source, "order_label");

const quickExplicitResult = runPreflight({
  project: "visual-template-system",
  tasks: quickTasksPath,
  taskId: "later-mvp-task",
  intent: "明確跳做稍後任務",
  proposedAcceptance: [],
});
assert.equal(quickExplicitResult.decision, "allow");
assert.equal(quickExplicitResult.active_task.id, "later-mvp-task");
assert.equal(quickExplicitResult.active_task.order_label, "VTS-MVP-04");

const quickBlockedExplicitResult = runPreflight({
  project: "visual-template-system",
  tasks: quickTasksPath,
  taskId: "blocked-mvp-task",
  intent: "嘗試指定被阻擋的任務",
  proposedAcceptance: [],
});
assert.equal(quickBlockedExplicitResult.decision, "blocked");
assert.equal(quickBlockedExplicitResult.active_task, null);

const hcFixturePath = path.join(tmpDir, "hc-gate-tasks.json");
fs.writeFileSync(
  hcFixturePath,
  JSON.stringify({
    tasks: [
      {
        id: "acp-work-anchor-preflight-flow",
        title: "ACP-MC-GATE-03 fixture missing HC decision",
        status: "todo",
        track: "control-plane",
        order_label: "ACP-MC-GATE-03",
        done_condition: "Fixture should not enter implementation before HC framing.",
      },
    ],
  }, null, 2),
  "utf-8",
);

const missingHcResult = runPreflight({
  project: "harness-mc",
  tasks: hcFixturePath,
  taskId: "acp-work-anchor-preflight-flow",
  intent: "進行 ACP-MC-GATE-03 fixture",
  proposedAcceptance: [],
});

assert.equal(missingHcResult.decision, "blocked");
assert.equal(missingHcResult.active_task.id, "acp-work-anchor-preflight-flow");
assert.equal(missingHcResult.hc_gate.required, true);
assert.match(missingHcResult.blocked_reason, /HC decision block is required/);
assert.match(missingHcResult.next_required_step, /HC decision block/);
assert.match(missingHcResult.next_required_step, /implementation flow/);
const missingHcMarkdown = formatMarkdown(missingHcResult);
assert.match(missingHcMarkdown, /blocked reason: HC decision block is required/);
assert.match(missingHcMarkdown, /required fields: task_scope/);
assert.doesNotMatch(missingHcMarkdown, /proposed task:/);

const withHcFixturePath = path.join(tmpDir, "hc-gate-ready-tasks.json");
fs.writeFileSync(
  withHcFixturePath,
  JSON.stringify({
    tasks: [
      {
        id: "acp-work-anchor-preflight-flow",
        title: "ACP-MC-GATE-03 fixture with HC decision",
        status: "todo",
        track: "control-plane",
        order_label: "ACP-MC-GATE-03",
        done_condition: "Fixture may enter execution after HC framing.",
        hc_decision: {
          task_scope: "harness-mc/acp-work-anchor-preflight-flow",
          hc_refs: ["#rightProblem", "#risk"],
          hc_reasoning: "Fixture confirms HC framing happens before implementation.",
          hc_confidence: 0.8,
          evidence_refs: ["milestones/harness-mc/tasks.json"],
          source_boundary: "HC is a thinking check, not source of truth; tasks.json remains canonical.",
        },
      },
    ],
  }, null, 2),
  "utf-8",
);

const withHcResult = runPreflight({
  project: "harness-mc",
  tasks: withHcFixturePath,
  taskId: "acp-work-anchor-preflight-flow",
  intent: "進行 ACP-MC-GATE-03 fixture",
  proposedAcceptance: [],
});

assert.equal(withHcResult.decision, "allow");
assert.equal(withHcResult.hc_gate.decision, "allow");
assert.equal(withHcResult.hc_gate.task_scope, "harness-mc/acp-work-anchor-preflight-flow");
assert.equal(withHcResult.event_gate, null, "without --event the gate must not activate (no startup burden)");

// JV-17 事件點 gate：dispatch 缺三件套 → blocked，缺件逐項點名
const dispatchMissing = runPreflight({
  project: "harness-mc",
  tasks: withHcFixturePath,
  taskId: "acp-work-anchor-preflight-flow",
  intent: "派工 fixture",
  event: "dispatch",
  proposedAcceptance: [],
});
assert.equal(dispatchMissing.decision, "blocked");
assert.equal(dispatchMissing.event_gate.decision, "blocked");
const failingIds = dispatchMissing.event_gate.checklist.filter((item) => !item.ok).map((item) => item.id);
assert.deepEqual(failingIds, ["write_boundary", "report_format", "model_tier", "verify_plan"]);
assert.match(dispatchMissing.blocked_reason, /不給三件套就派工 = 違規/);
assert.match(
  dispatchMissing.event_gate.checklist.find((item) => item.id === "report_format").ref,
  /model-dispatch-contract\.md#2/,
);
assert.match(dispatchMissing.event_gate.watch_signals.stop_signals, /judgment-externalization-matrix\.md#第一類/);
const dispatchMarkdown = formatMarkdown(dispatchMissing);
assert.match(dispatchMarkdown, /事件點 gate（dispatch）: blocked/);
assert.match(dispatchMarkdown, /\[ \] write_boundary/);

// JV-17：dispatch 三件套＋分級＋驗證計畫齊 → allow
const dispatchReady = runPreflight({
  project: "harness-mc",
  tasks: withHcFixturePath,
  taskId: "acp-work-anchor-preflight-flow",
  intent: "派工 fixture",
  event: "dispatch",
  scope: ["scripts/foo.mjs", "milestones/harness-mc/tasks.json"],
  template: "模板4-審查",
  modelTier: "sonnet",
  verifyPlan: "npm run test:tasks + fresh-context read-back",
  proposedAcceptance: [],
});
assert.equal(dispatchReady.decision, "allow");
assert.equal(dispatchReady.event_gate.decision, "allow");
assert.ok(dispatchReady.event_gate.checklist.every((item) => item.ok));

// JV-17：implementation 只要求 anchor + HC + 可寫邊界
const implReady = runPreflight({
  project: "harness-mc",
  tasks: withHcFixturePath,
  taskId: "acp-work-anchor-preflight-flow",
  intent: "實作 fixture",
  event: "implementation",
  scope: ["scripts/foo.mjs"],
  proposedAcceptance: [],
});
assert.equal(implReady.decision, "allow");
assert.equal(implReady.event_gate.checklist.length, 3, "implementation event must not demand dispatch-only items");

const implMissingScope = runPreflight({
  project: "harness-mc",
  tasks: withHcFixturePath,
  taskId: "acp-work-anchor-preflight-flow",
  intent: "實作 fixture",
  event: "implementation",
  proposedAcceptance: [],
});
assert.equal(implMissingScope.decision, "blocked");
assert.deepEqual(
  implMissingScope.event_gate.checklist.filter((item) => !item.ok).map((item) => item.id),
  ["write_boundary"],
);

const acceptanceMatrix = [
  { id: "MX-01", what: "first", pass_condition: "passes", verification: ["fixture"] },
  { id: "MX-02", what: "second", pass_condition: "passes", verification: ["fixture"] },
];
const acceptanceFixturePath = path.join(tmpDir, "acceptance-gate-tasks.json");
fs.writeFileSync(
  acceptanceFixturePath,
  JSON.stringify({
    tasks: [{
      id: "acceptance-matrix-task",
      title: "Acceptance matrix fixture",
      status: "in_progress",
      track: "product",
      done_condition: "Acceptance event resolves the canonical matrix and fresh results.",
      acceptance_matrix: acceptanceMatrix,
    }],
  }, null, 2),
  "utf8",
);
const matrixFingerprint = `sha256:${crypto.createHash("sha256").update(JSON.stringify(acceptanceMatrix)).digest("hex")}`;
const acceptanceReady = runPreflight({
  project: "fixture",
  tasks: acceptanceFixturePath,
  taskId: "acceptance-matrix-task",
  intent: "驗收 fixture",
  event: "acceptance",
  scope: ["read-only acceptance evidence"],
  matrixFingerprint,
  acceptanceResults: ["MX-01=pass", "MX-02=pass"],
  proposedAcceptance: [],
});
assert.equal(acceptanceReady.decision, "allow");
assert.ok(acceptanceReady.event_gate.acceptance_receipt, "acceptance receipt missing");
assert.deepEqual(acceptanceReady.event_gate.acceptance_receipt.required_ids, ["MX-01", "MX-02"]);
assert.equal(acceptanceReady.event_gate.acceptance_receipt.matrix_fingerprint, matrixFingerprint);
assert.equal(acceptanceReady.event_gate.acceptance_receipt.all_passed, true);
assert.match(acceptanceReady.event_gate.acceptance_receipt.matrix_ref, /acceptance-gate-tasks\.json#acceptance-matrix-task\.acceptance_matrix$/);

const acceptanceMissingResult = runPreflight({
  project: "fixture",
  tasks: acceptanceFixturePath,
  taskId: "acceptance-matrix-task",
  event: "acceptance",
  scope: ["read-only acceptance evidence"],
  matrixFingerprint,
  acceptanceResults: ["MX-01=pass"],
  proposedAcceptance: [],
});
assert.equal(acceptanceMissingResult.decision, "blocked");
assert.ok(acceptanceMissingResult.event_gate.checklist.some((item) => item.id === "matrix_results_exact" && !item.ok));

const acceptanceStaleFingerprint = runPreflight({
  project: "fixture",
  tasks: acceptanceFixturePath,
  taskId: "acceptance-matrix-task",
  event: "acceptance",
  scope: ["read-only acceptance evidence"],
  matrixFingerprint: "sha256:stale",
  acceptanceResults: ["MX-01=pass", "MX-02=pass"],
  proposedAcceptance: [],
});
assert.equal(acceptanceStaleFingerprint.decision, "blocked");
assert.ok(acceptanceStaleFingerprint.event_gate.checklist.some((item) => item.id === "matrix_fingerprint" && !item.ok));

const weeklyCoreFixturePath = path.join(tmpDir, "weekly-core-tasks.json");
fs.writeFileSync(
  weeklyCoreFixturePath,
  JSON.stringify({
    tasks: [
      {
        id: "task-lifecycle-jv32-gate",
        title: "JV-40 weekly core runtime fixture",
        status: "in_progress",
        track: "governance",
        order_label: "JV-40",
        done_condition: "Runtime preflight blocks execution once the explicit review date arrives.",
        weekly_core: true,
        review_date: "2026-07-25",
        hc_decision: {
          task_scope: "morrowise/task-lifecycle-jv32-gate",
          hc_refs: ["#rightProblem", "#risk"],
          hc_reasoning: "Fixture validates the live weekly core deadline gate.",
          hc_confidence: 0.8,
          evidence_refs: ["milestones/morrowise/tasks.json"],
          source_boundary: "HC is a thinking check, not source of truth; tasks.json remains canonical.",
        },
      },
      {
        id: "non-core-maintenance-task",
        title: "Non-core task must not bypass an expired weekly core",
        status: "in_progress",
        track: "operations",
        done_condition: "Fixture proves the global weekly core deadline blocks every MorroWise execution target.",
      },
    ],
  }, null, 2),
  "utf-8",
);

const expiredWeeklyCore = runPreflight({
  project: "morrowise",
  tasks: weeklyCoreFixturePath,
  taskId: "task-lifecycle-jv32-gate",
  intent: "continue weekly core implementation",
  asOf: "2026-07-25",
  proposedAcceptance: [],
});
assert.equal(expiredWeeklyCore.decision, "blocked");
assert.equal(expiredWeeklyCore.weekly_core_gate.decision, "blocked");
assert.match(expiredWeeklyCore.blocked_reason, /review_date has arrived/);

const currentWeeklyCore = runPreflight({
  project: "morrowise",
  tasks: weeklyCoreFixturePath,
  taskId: "task-lifecycle-jv32-gate",
  intent: "continue weekly core implementation",
  asOf: "2026-07-24",
  proposedAcceptance: [],
});
assert.equal(currentWeeklyCore.decision, "allow");
assert.equal(currentWeeklyCore.weekly_core_gate.decision, "allow");

const nonCoreTargetWithExpiredWeeklyCore = runPreflight({
  project: "morrowise",
  tasks: weeklyCoreFixturePath,
  taskId: "non-core-maintenance-task",
  intent: "start unrelated maintenance while weekly core is overdue",
  asOf: "2026-07-25",
  proposedAcceptance: [],
});
assert.equal(nonCoreTargetWithExpiredWeeklyCore.decision, "allow");
assert.equal(nonCoreTargetWithExpiredWeeklyCore.weekly_core_gate.decision, "allow");
assert.equal(nonCoreTargetWithExpiredWeeklyCore.weekly_core_gate.warning_code, "weekly_core_overdue");
assert.match(nonCoreTargetWithExpiredWeeklyCore.weekly_core_gate.reason, /task-lifecycle-jv32-gate/);
assert.match(nonCoreTargetWithExpiredWeeklyCore.weekly_core_gate.reason, /review_date has arrived/);
assert.equal(nonCoreTargetWithExpiredWeeklyCore.blocked_reason, undefined);

// A selected workbook must never fall through to an alternative canonical
// source, even when that source would yield an otherwise valid active task.
const originalReadFileSync = fs.readFileSync;
let canonicalFallbackReads = 0;
try {
  fs.readFileSync = function (file, ...options) {
    if (typeof file === "string" && path.resolve(file) === path.resolve(fixturePath)) {
      canonicalFallbackReads += 1;
      throw new Error("workbook_canonical_fallback_attempted");
    }
    return originalReadFileSync.call(this, file, ...options);
  };
  const mixedSource = runPreflight({
    workbook: path.join(tmpDir, "unread-workbook.md"),
    tasks: fixturePath,
    project: "house123-buy",
    intent: "implementation",
    proposedAcceptance: [],
  });
  assert.equal(mixedSource.decision, "blocked");
  assert.equal(canonicalFallbackReads, 0, "mixed source must be rejected before reading tasks");
} finally {
  fs.readFileSync = originalReadFileSync;
}

// The native host reader is imported only after a child process installs the
// test-only OS fixture. No real transcript is read, no production reader seam
// is exposed, and this exercises the public entry rather than its adapter only.
const workbookPublicCases = String.raw`
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const [entry,fixtureModule,sessionModule,adapterModule,coordinationModule]=process.argv.slice(1);
// Node -e places the first data argument in argv[1]; it is not this module's
// executable filename and must not trigger an imported module's CLI guard.
process.argv=[process.execPath,'workbook-public-fixture'];
const {withHostFixture,contextInput}=await import(pathToFileURL(fixtureModule).href);
await withHostFixture(async f=>{
  const h=path.join(f.root,'harness-mc'),dir=path.join(h,'milestones','fixture');fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'project.json'),JSON.stringify({name:'Fixture'}));
  const tasksPath=path.join(dir,'tasks.json'),tasksBytes=JSON.stringify({project:'fixture',tasks:[]});fs.writeFileSync(tasksPath,tasksBytes);
  const regPath=path.join(h,'system-workflow','registries','morrowise-project-topology.json');fs.mkdirSync(path.dirname(regPath),{recursive:true});
  fs.writeFileSync(regPath,JSON.stringify({migration_state_vocabulary:['inventory_only','blocked'],records:[{id:'fixture',classification:'canonical_project',migration_state:'inventory_only',repo_ref:'$COLLAB/repo'}]}));
  // Existing HARNESS_MC_ROOT embedding seam, set before module initialization.
  process.env.HARNESS_MC_ROOT=h;
  const {runPreflight,formatMarkdown}=await import(pathToFileURL(entry).href);
  const session=await import(pathToFileURL(sessionModule).href);
  const {getWorkbookRuntimeContext}=await import(pathToFileURL(adapterModule).href);
  const {acquireWorkbookClaim}=await import(pathToFileURL(coordinationModule).href);
  const context=session.createWorkbookSessionContext(contextInput(session,f));
  const args={workbook:f.workbook.home,project:'fixture',intent:'implementation',proposedAcceptance:[],scope:[]};
  for(const untrusted of [undefined,{approved:true},JSON.parse(JSON.stringify(context))]) {
    const denied=runPreflight(args,untrusted);assert.equal(denied.source_kind,'workbook');assert.equal(denied.decision,'requires_human_approval');
    assert.doesNotThrow(()=>formatMarkdown(denied));assert.doesNotThrow(()=>JSON.stringify(denied));
  }
  const missingTasks=path.join(f.root,'must-not-read.json');
  for(const extra of [{tasks:missingTasks},{intent:'proposal'},{proposedId:'fake-new-id'},{proposedTitle:'unreviewed replacement'}]) {
    const denied=runPreflight({...args,...extra},context);assert.equal(denied.source_kind,'workbook');assert.equal(denied.decision,'blocked');assert.match(denied.reason,/mutually_exclusive|proposal/);assert.doesNotThrow(()=>formatMarkdown(denied));
  }
  for(const extra of [{project:'other'},{taskId:'other'},{scope:['foreign.txt']}])assert.equal(runPreflight({...args,...extra},context).decision,'blocked');
  const allowed=runPreflight(args,context);assert.equal(allowed.decision,'allow',JSON.stringify(allowed));assert.equal(allowed.active_task.id,f.contract.task_id);assert.equal(allowed.execution_ready,false);
  const aliased={...args,workbookPath:args.workbook};delete aliased.workbook;assert.equal(runPreflight(aliased,context).decision,'allow','API alias must route before canonical lookup');
  const markdown=formatMarkdown(allowed);for(const text of ['workbook',f.contract.task_id,allowed.reason])assert.ok(markdown.includes(text),'Markdown should show source, work ID and reason');
  assert.match(markdown,/version|版本/i);assert.match(markdown,/next|下一步/i);assert.doesNotMatch(markdown,/undefined|NaN|\[object Object\]/);
  assert.equal(JSON.parse(JSON.stringify(allowed)).source_kind,'workbook');
  assert.equal(runPreflight({...args,event:'acceptance'},context).decision,'blocked','public acceptance requires actual owned claim');
  const runtime=getWorkbookRuntimeContext(context,f.workbook,{harnessRoot:h});
  const acquired=acquireWorkbookClaim({...runtime,workbook:f.workbook,repoId:'fixture',sessionId:f.sessionId,owner:'Fixture'});assert.equal(acquired.decision,'READY',JSON.stringify(acquired));
  const accepted=runPreflight({...args,event:'acceptance'},context);assert.equal(accepted.decision,'allow',JSON.stringify(accepted));assert.equal(accepted.acceptance_receipt.results[0].status,'passed');assert.equal(accepted.read_only,false);assert.doesNotThrow(()=>formatMarkdown(accepted));
  assert.equal(runPreflight({...args,event:'acceptance',acceptanceResults:['A1=pass']},context).decision,'blocked');
  fs.writeFileSync(path.join(f.repo,'a.txt'),'bad');const failed=runPreflight({...args,event:'acceptance'},context);assert.equal(failed.decision,'blocked');assert.equal(failed.reason,'verifier_failed');fs.writeFileSync(path.join(f.repo,'a.txt'),'base');
  assert.equal(fs.readFileSync(tasksPath,'utf8'),tasksBytes,'public workbook API must not write central task');
  const cli=(flags)=>spawnSync(process.execPath,[entry,...flags],{encoding:'utf8',env:{...process.env,HARNESS_MC_ROOT:h}});
  for(const selector of [['--workbook',f.workbook.home],['--workbook='+f.workbook.home]]) {
    const json=cli([...selector,'--json']);assert.notEqual(json.status,0);assert.equal(json.signal,null);const body=JSON.parse(json.stdout);assert.equal(body.source_kind,'workbook');assert.equal(body.decision,'requires_human_approval');assert.equal(body.work_id,'fixture/'+f.contract.task_id);assert.doesNotMatch(json.stderr,/TypeError|Unknown argument/);
    const md=cli(selector);assert.notEqual(md.status,0);assert.ok(md.stdout.includes('workbook'));assert.ok(md.stdout.includes(f.contract.task_id));assert.ok(md.stdout.includes('requires_human_approval'));assert.doesNotMatch(md.stderr,/TypeError|Unknown argument/);
  }
  for(const extra of [['--tasks',missingTasks],['--intent','proposal'],['--proposed-id','fake-new-id']]) {
    const r=cli(['--workbook',f.workbook.home,...extra,'--json']);assert.notEqual(r.status,0);const denied=JSON.parse(r.stdout);assert.equal(denied.source_kind,'workbook');assert.equal(denied.decision,'blocked');assert.doesNotMatch(r.stderr,/ENOENT|TypeError/);
  }
  for(const bad of [['--workbook'],['--workbook='],['--workbook','--json'],['--workbook',f.workbook.home,'--workbook',f.workbook.home]]) {
    const r=cli(bad);assert.notEqual(r.status,0);assert.match(r.stderr,/workbook/i);assert.doesNotMatch(r.stderr,/TypeError/);
  }
  const help=cli(['--help']);assert.equal(help.status,0);assert.match(help.stdout,/--workbook/);
  console.log('PASS public workbook entry: parse/early route, mixed source denial, branded context, CLI fail-closed, Markdown/JSON, claimed real acceptance and unchanged canonical task');
});
`;
const workbookPublicRun=spawnSync(process.execPath,["--input-type=module","-e",workbookPublicCases,
  path.join(root,"scripts","work-anchor-preflight.mjs"),
  path.join(root,"scripts","verify-workbook-session-context.mjs"),
  path.join(root,"scripts","lib","workbook-session-context.mjs"),
  path.join(root,"scripts","lib","workbook-preflight-adapter.mjs"),
  path.join(root,"scripts","lib","workbook-coordination.mjs"),
],{encoding:"utf8",timeout:60000});
assert.equal(workbookPublicRun.status,0,workbookPublicRun.stderr||workbookPublicRun.stdout||String(workbookPublicRun.error));
process.stdout.write(workbookPublicRun.stdout);
console.log("Work-anchor preflight verification OK");
