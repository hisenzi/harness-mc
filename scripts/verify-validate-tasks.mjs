import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "validate-tasks-"));
const repo = path.join(tmpRoot, "repo");
const script = path.resolve("scripts", "validate-tasks.mjs");
const deployWorkflow = fs.readFileSync(path.resolve(".github", "workflows", "deploy.yml"), "utf-8");

if (!deployWorkflow.includes("node scripts/validate-tasks.mjs --base \"${{ github.event.before }}\"")) {
  throw new Error("Expected Pages push workflow to validate committed task changes from github.event.before to HEAD.");
}

function run(args, { cwd = repo, expectFailure = false } = {}) {
  try {
    const stdout = execFileSync(process.execPath, [script, ...args], {
      cwd,
      env: { ...process.env, HARNESS_MC_ROOT: repo },
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (expectFailure) throw new Error(`Expected failure but command passed: ${args.join(" ")}`);
    return { status: 0, output: stdout };
  } catch (error) {
    if (!expectFailure) {
      const stderr = error.stderr ? `\n${error.stderr}` : "";
      throw new Error(`Command failed unexpectedly: ${args.join(" ")}${stderr}`);
    }
    return {
      status: error.status || 1,
      output: `${error.stdout || ""}${error.stderr || ""}`,
    };
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function git(args) {
  return execFileSync("git", args, {
    cwd: repo,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

fs.mkdirSync(repo, { recursive: true });
git(["init"]);
git(["config", "user.email", "verify@example.test"]);
git(["config", "user.name", "Task Validator Verify"]);

const baseTasks = {
  tasks: [
    {
      id: "acp-good-task",
      title: "合格 ACP 任務",
      status: "todo",
      track: "control-plane",
      order_label: "ACP-VERIFY-01",
      done_condition: "A valid task has enough fields for any agent to execute.",
      hc_decision: {
        task_scope: "harness-mc/acp-good-task",
        hc_refs: ["#rightProblem", "#risk"],
        hc_reasoning: "Fixture validates that active ACP tasks carry HC framing before execution.",
        hc_confidence: 0.8,
        evidence_refs: ["milestones/harness-mc/tasks.json"],
        source_boundary: "HC is a thinking check, not source of truth; tasks.json remains canonical."
      },
      depends_on: [],
      external_refs: {},
    },
    {
      id: "legacy-missing-fields",
      title: "歷史缺欄位任務",
      status: "todo",
    },
    {
      id: "review-window-base",
      title: "檢視窗口基準任務",
      status: "todo",
      track: "control-plane",
      order_label: "ACP-REVIEW-WINDOW",
      done_condition: "Fixture validates a non-weekly planning review checkpoint.",
      hc_decision: {
        task_scope: "harness-mc/review-window-base",
        hc_refs: ["#rightProblem"],
        hc_reasoning: "Fixture separates a planning checkpoint from weekly-core lifecycle governance.",
        hc_confidence: 0.8,
        evidence_refs: ["milestones/harness-mc/tasks.json"],
        source_boundary: "HC is a thinking check, not source of truth; tasks.json remains canonical."
      },
      jv32_route: { workflows: ["task-lifecycle"] },
      task_lifecycle: {
        route: "JV-32/task-lifecycle",
        history: [{
          operation: "create",
          from_status: null,
          to_status: "todo",
          reason: "Fixture creates a governed task before its planning checkpoint is added.",
          evidence_refs: ["milestones/harness-mc/tasks.json"],
          recorded_at: "2026-07-18"
        }]
      }
    },
  ],
};

writeJson(path.join(repo, "milestones", "harness-mc", "tasks.json"), baseTasks);
writeJson(path.join(repo, "milestones", "morrowise", "tasks.json"), {
  tasks: [morrowiseSeedTask()]
});
git(["add", "milestones/harness-mc/tasks.json"]);
git(["add", "milestones/morrowise/tasks.json"]);
git(["commit", "-m", "seed tasks"]);

const clean = run(["--changed-only"]);
if (!clean.output.includes("Task validation OK")) {
  throw new Error("Expected changed-only clean state to pass.");
}

const legacyWarn = run(["--project", "harness-mc"]);
if (!legacyWarn.output.includes("Task validation OK")) {
  throw new Error("Expected full project scan to warn but pass.");
}

const deletedCanonicalTask = structuredClone(baseTasks);
deletedCanonicalTask.tasks = deletedCanonicalTask.tasks.filter((task) => task.id !== "acp-good-task");
writeJson(path.join(repo, "milestones", "harness-mc", "tasks.json"), deletedCanonicalTask);

const deletedCanonicalTaskResult = run(["--changed-only", "--project", "harness-mc"], { expectFailure: true });
if (!deletedCanonicalTaskResult.output.includes("canonical task deletion is forbidden; retain the task and use cancel or archive lifecycle")) {
  throw new Error("Expected direct canonical task deletion to fail.");
}

writeJson(path.join(repo, "milestones", "harness-mc", "tasks.json"), baseTasks);

fs.unlinkSync(path.join(repo, "milestones", "harness-mc", "tasks.json"));
const deletedCanonicalTaskFileResult = run(["--changed-only", "--project", "harness-mc"], { expectFailure: true });
if (!deletedCanonicalTaskFileResult.output.includes("canonical tasks.json deletion is forbidden; restore the file and use cancel or archive lifecycle")) {
  throw new Error("Expected direct canonical tasks.json deletion to fail.");
}

writeJson(path.join(repo, "milestones", "harness-mc", "tasks.json"), baseTasks);

const changedTasks = structuredClone(baseTasks);
changedTasks.tasks.push({
  id: "acp-bad-task",
  title: "缺欄位 ACP 任務",
  status: "todo",
  track: "control-plane",
});
writeJson(path.join(repo, "milestones", "harness-mc", "tasks.json"), changedTasks);

const failed = run(["--changed-only", "--project", "harness-mc"], { expectFailure: true });
if (!failed.output.includes("ERROR milestones/harness-mc/tasks.json task=acp-bad-task")) {
  throw new Error("Expected changed ACP task to fail validation.");
}
if (!failed.output.includes("done_condition must be a non-empty string")) {
  throw new Error("Expected missing done_condition error.");
}
if (!failed.output.includes("order_label is required")) {
  throw new Error("Expected missing order_label error.");
}
if (!failed.output.includes("hc_decision is required")) {
  throw new Error("Expected missing hc_decision error.");
}

const malformedHc = structuredClone(baseTasks);
malformedHc.tasks.push({
  id: "acp-malformed-hc",
  title: "HC 格式錯誤任務",
  status: "todo",
  track: "control-plane",
  order_label: "ACP-VERIFY-02",
  done_condition: "Changed system tasks must include a usable HC decision block.",
  hc_decision: {
    task_scope: "harness-mc/acp-malformed-hc",
    hc_refs: ["risk"],
    hc_reasoning: "Missing hash prefix and source boundary contract.",
    hc_confidence: 2,
    evidence_refs: [],
    source_boundary: "HC helps."
  }
});
writeJson(path.join(repo, "milestones", "harness-mc", "tasks.json"), malformedHc);

const malformedFailed = run(["--changed-only", "--project", "harness-mc"], { expectFailure: true });
if (!malformedFailed.output.includes("hc_decision.hc_refs entries must be HC refs like #risk")) {
  throw new Error("Expected malformed HC refs error.");
}
if (!malformedFailed.output.includes("hc_decision.source_boundary must mention thinking check/source of truth or 思考檢查/正本")) {
  throw new Error("Expected source boundary error.");
}
if (!malformedFailed.output.includes("hc_decision.hc_confidence must be a number from 0 to 1")) {
  throw new Error("Expected HC confidence range error.");
}

const incompleteExecutionContract = structuredClone(baseTasks);
incompleteExecutionContract.tasks[0].execution_contract = {
  owner: "harness-mc/acp-good-task",
  source_of_truth: ["milestones/harness-mc/tasks.json"],
  inputs: ["canonical task state"],
  outputs: ["controlled result"],
  verifiers: [],
  stop_condition: "",
};
writeJson(path.join(repo, "milestones", "harness-mc", "tasks.json"), incompleteExecutionContract);

const incompleteExecutionContractResult = run(["--changed-only", "--project", "harness-mc"], { expectFailure: true });
if (!incompleteExecutionContractResult.output.includes("execution_contract.verifiers must be a non-empty array")) {
  throw new Error("Expected empty execution_contract.verifiers to fail validation.");
}
if (!incompleteExecutionContractResult.output.includes("execution_contract.stop_condition must be a non-empty string")) {
  throw new Error("Expected missing execution_contract.stop_condition to fail validation.");
}

const closedWithoutArchitectureDecision = {
  tasks: [
    {
      id: "morrowise-closed-without-arch",
      title: "缺 Architecture Decision 的已關閉任務",
      status: "completed",
      track: "governance",
      order_label: "JV-VERIFY-01",
      done_condition: "Closed MorroWise governance tasks must record architecture promotion judgment.",
      hc_decision: {
        task_scope: "morrowise/closed-without-arch",
        hc_refs: ["#rightProblem"],
        hc_reasoning: "Fixture validates closeout gate coverage.",
        hc_confidence: 0.7,
        evidence_refs: ["milestones/morrowise/tasks.json"],
        source_boundary: "HC is a thinking check, not source of truth; tasks.json remains canonical."
      },
      jv32_route: {
        workflows: ["task-lifecycle", "closeout-commit-routing"]
      },
      task_lifecycle: {
        route: "JV-32/task-lifecycle",
        history: [
          {
            operation: "create",
            from_status: null,
            to_status: "completed",
            reason: "Fixture records a newly created historical closeout record.",
            evidence_refs: ["milestones/morrowise/tasks.json"],
            recorded_at: "2026-07-18",
            semantic_intake: semanticIntake("genuinely_new", {
              comparedTaskRefs: ["morrowise/morrowise-seed-task"],
            })
          }
        ]
      }
    },
    morrowiseSeedTask()
  ]
};
writeJson(path.join(repo, "milestones", "morrowise", "tasks.json"), closedWithoutArchitectureDecision);

const missingArchitectureDecision = run(["--changed-only", "--project", "morrowise"], { expectFailure: true });
if (!missingArchitectureDecision.output.includes("architecture_decision is required before closing MorroWise governance/runtime-delivery/auditor-mvp tasks")) {
  throw new Error("Expected missing architecture_decision closeout error.");
}

const closedWithArchitectureDecision = structuredClone(closedWithoutArchitectureDecision);
closedWithArchitectureDecision.tasks[0].architecture_decision = {
  decision: "not_required",
  evaluated_at: "2026-07-07",
  reason: "Fixture task does not add a reusable subsystem."
};
writeJson(path.join(repo, "milestones", "morrowise", "tasks.json"), closedWithArchitectureDecision);

const architectureDecisionPass = run(["--changed-only", "--project", "morrowise"]);
if (!architectureDecisionPass.output.includes("Task validation OK")) {
  throw new Error("Expected architecture_decision fixture to pass.");
}

const malformedAdmissionReview = structuredClone(closedWithArchitectureDecision);
malformedAdmissionReview.tasks[0].architecture_decision.admission_review = {
  scope: "version_improvement",
  admission_record_ref: "$COLLAB/harness-mc/system-workflow/registries/morrowise-architecture-subsystems.json#morrowise-dev-workflow-catalog",
  index_action: "no_index_change",
  sync_check_ref: "not-the-controlled-sync-check",
  evidence_refs: [],
  reason: "Fixture validates malformed architecture admission review rejection."
};
writeJson(path.join(repo, "milestones", "morrowise", "tasks.json"), malformedAdmissionReview);

const malformedAdmissionReviewResult = run(["--changed-only", "--project", "morrowise"], { expectFailure: true });
if (!malformedAdmissionReviewResult.output.includes("architecture_decision.admission_review.sync_check_ref must reference the controlled architecture sync check")) {
  throw new Error("Expected malformed Architecture Admission Review sync ref error.");
}
if (!malformedAdmissionReviewResult.output.includes("architecture_decision.admission_review.evidence_refs must be a non-empty string array")) {
  throw new Error("Expected malformed Architecture Admission Review evidence error.");
}

const validAdmissionReview = structuredClone(closedWithArchitectureDecision);
validAdmissionReview.tasks[0].architecture_decision.admission_review = {
  scope: "version_improvement",
  admission_record_ref: "$COLLAB/harness-mc/system-workflow/registries/morrowise-architecture-subsystems.json#morrowise-dev-workflow-catalog",
  index_action: "no_index_change",
  sync_check_ref: "python3 \"$COLLAB/notyet-harness/000_Agent/scripts/sync-architecture-subsystems.py\" --check",
  evidence_refs: ["node scripts/verify-morrowise-dev-workflow-catalog.mjs"],
  reason: "Fixture validates the structured version-improvement admission review."
};
writeJson(path.join(repo, "milestones", "morrowise", "tasks.json"), validAdmissionReview);

const validAdmissionReviewResult = run(["--changed-only", "--project", "morrowise"]);
if (!validAdmissionReviewResult.output.includes("Task validation OK")) {
  throw new Error("Expected valid Architecture Admission Review fixture to pass.");
}

const lifecycleRouteMissing = structuredClone(baseTasks);
lifecycleRouteMissing.tasks.push({
  id: "acp-lifecycle-route-missing",
  title: "缺 task lifecycle route 的任務",
  status: "todo",
  track: "control-plane",
  order_label: "ACP-VERIFY-03",
  done_condition: "New tasks must carry the governed task lifecycle route.",
  hc_decision: {
    task_scope: "harness-mc/acp-lifecycle-route-missing",
    hc_refs: ["#rightProblem"],
    hc_reasoning: "Fixture proves new canonical task state cannot bypass JV-32 task lifecycle routing.",
    hc_confidence: 0.8,
    evidence_refs: ["milestones/harness-mc/tasks.json"],
    source_boundary: "HC is a thinking check, not source of truth; tasks.json remains canonical."
  }
});
writeJson(path.join(repo, "milestones", "harness-mc", "tasks.json"), lifecycleRouteMissing);

const missingLifecycleRoute = run(["--changed-only", "--project", "harness-mc"], { expectFailure: true });
if (!missingLifecycleRoute.output.includes("jv32_route is required for changed or new canonical task mutations")) {
  throw new Error("Expected missing JV-32 lifecycle route error.");
}

const lifecycleHistoryMissing = structuredClone(baseTasks);
lifecycleHistoryMissing.tasks.push({
  id: "acp-lifecycle-history-missing",
  title: "缺 task lifecycle history 的任務",
  status: "todo",
  track: "control-plane",
  order_label: "ACP-VERIFY-04",
  done_condition: "Changed tasks must preserve a lifecycle evidence record.",
  hc_decision: {
    task_scope: "harness-mc/acp-lifecycle-history-missing",
    hc_refs: ["#rightProblem"],
    hc_reasoning: "Fixture proves a route alone is insufficient without lifecycle evidence.",
    hc_confidence: 0.8,
    evidence_refs: ["milestones/harness-mc/tasks.json"],
    source_boundary: "HC is a thinking check, not source of truth; tasks.json remains canonical."
  },
  jv32_route: {
    workflows: ["task-lifecycle"]
  }
});
writeJson(path.join(repo, "milestones", "harness-mc", "tasks.json"), lifecycleHistoryMissing);

const missingLifecycleHistory = run(["--changed-only", "--project", "harness-mc"], { expectFailure: true });
if (!missingLifecycleHistory.output.includes("task_lifecycle is required for changed or new canonical task mutations")) {
  throw new Error("Expected missing lifecycle history error.");
}

const lifecycleStatusMismatch = structuredClone(baseTasks);
Object.assign(lifecycleStatusMismatch.tasks[0], {
  jv32_route: { workflows: ["task-lifecycle"] },
  task_lifecycle: {
    route: "JV-32/task-lifecycle",
    history: [{
      operation: "amend",
      from_status: "todo",
      to_status: "in_progress",
      reason: "Fixture intentionally mismatches current task status.",
      evidence_refs: ["milestones/harness-mc/tasks.json"],
      recorded_at: "2026-07-18"
    }]
  }
});
writeJson(path.join(repo, "milestones", "harness-mc", "tasks.json"), lifecycleStatusMismatch);

const mismatchedLifecycleStatus = run(["--changed-only", "--project", "harness-mc"], { expectFailure: true });
if (!mismatchedLifecycleStatus.output.includes("task_lifecycle.history last to_status must match task.status")) {
  throw new Error("Expected lifecycle status mismatch error.");
}

const suspendedWithoutRecovery = structuredClone(baseTasks);
Object.assign(suspendedWithoutRecovery.tasks[0], {
  status: "deferred",
  jv32_route: { workflows: ["task-lifecycle"] },
  task_lifecycle: {
    route: "JV-32/task-lifecycle",
    history: [{
      operation: "suspend",
      from_status: "todo",
      to_status: "deferred",
      reason: "Fixture intentionally omits its recovery condition.",
      evidence_refs: ["milestones/harness-mc/tasks.json"],
      recorded_at: "2026-07-18"
    }]
  }
});
writeJson(path.join(repo, "milestones", "harness-mc", "tasks.json"), suspendedWithoutRecovery);

const missingRecovery = run(["--changed-only", "--project", "harness-mc"], { expectFailure: true });
if (!missingRecovery.output.includes("deferred lifecycle event requires reactivation_criteria")) {
  throw new Error("Expected deferred recovery condition error.");
}

const cancelledWithoutResolution = structuredClone(baseTasks);
Object.assign(cancelledWithoutResolution.tasks[0], {
  status: "cancelled",
  jv32_route: { workflows: ["task-lifecycle"] },
  task_lifecycle: {
    route: "JV-32/task-lifecycle",
    history: [{
      operation: "cancel",
      from_status: "todo",
      to_status: "cancelled",
      reason: "Fixture intentionally omits replacement or no-replacement rationale.",
      evidence_refs: ["milestones/harness-mc/tasks.json"],
      recorded_at: "2026-07-18"
    }]
  }
});
writeJson(path.join(repo, "milestones", "harness-mc", "tasks.json"), cancelledWithoutResolution);

const missingCancellationResolution = run(["--changed-only", "--project", "harness-mc"], { expectFailure: true });
if (!missingCancellationResolution.output.includes("cancelled lifecycle event requires replacement_task_id or no_replacement_reason")) {
  throw new Error("Expected cancelled lifecycle resolution error.");
}

const archivedWithBlankSupersession = structuredClone(baseTasks);
Object.assign(archivedWithBlankSupersession.tasks[0], {
  status: "archived",
  jv32_route: { workflows: ["task-lifecycle"] },
  task_lifecycle: {
    route: "JV-32/task-lifecycle",
    history: [{
      operation: "archive",
      from_status: "todo",
      to_status: "archived",
      reason: "Fixture intentionally supplies an invalid supersession reference.",
      evidence_refs: ["milestones/harness-mc/tasks.json"],
      recorded_at: "2026-07-18",
      superseded_by: ""
    }]
  }
});
writeJson(path.join(repo, "milestones", "harness-mc", "tasks.json"), archivedWithBlankSupersession);

const invalidArchiveSupersession = run(["--changed-only", "--project", "harness-mc"], { expectFailure: true });
if (!invalidArchiveSupersession.output.includes("archived lifecycle event superseded_by must be a non-empty task id when present")) {
  throw new Error("Expected archived lifecycle supersession error.");
}

const completedWithoutCloseout = structuredClone(baseTasks);
Object.assign(completedWithoutCloseout.tasks[0], {
  status: "completed",
  jv32_route: { workflows: ["task-lifecycle"] },
  task_lifecycle: {
    route: "JV-32/task-lifecycle",
    history: [{
      operation: "complete",
      from_status: "todo",
      to_status: "completed",
      reason: "Fixture intentionally omits the required closeout workflow.",
      evidence_refs: ["milestones/harness-mc/tasks.json"],
      recorded_at: "2026-07-18"
    }]
  }
});
writeJson(path.join(repo, "milestones", "harness-mc", "tasks.json"), completedWithoutCloseout);

const missingCloseoutRoute = run(["--changed-only", "--project", "harness-mc"], { expectFailure: true });
if (!missingCloseoutRoute.output.includes("completed task lifecycle mutations require jv32_route.workflows to include closeout-commit-routing")) {
  throw new Error("Expected completed lifecycle closeout route error.");
}

const validLifecycleMutation = structuredClone(baseTasks);
Object.assign(validLifecycleMutation.tasks[0], {
  status: "completed",
  jv32_route: { workflows: ["task-lifecycle", "closeout-commit-routing"] },
  task_lifecycle: {
    route: "JV-32/task-lifecycle",
    history: [{
      operation: "complete",
      from_status: "todo",
      to_status: "completed",
      reason: "Fixture records a valid verified closeout mutation.",
      evidence_refs: ["milestones/harness-mc/tasks.json", "npm run test:tasks"],
      recorded_at: "2026-07-18"
    }]
  }
});
writeJson(path.join(repo, "milestones", "harness-mc", "tasks.json"), validLifecycleMutation);

const validLifecyclePass = run(["--changed-only", "--project", "harness-mc"]);
if (!validLifecyclePass.output.includes("Task validation OK")) {
  throw new Error("Expected valid lifecycle mutation to pass.");
}

const newTaskWithFollowupMutation = structuredClone(baseTasks);
newTaskWithFollowupMutation.tasks.push({
  id: "acp-new-task-with-followup",
  title: "新任務與後續修改",
  status: "in_progress",
  track: "control-plane",
  order_label: "ACP-VERIFY-05",
  done_condition: "A newly created task may record a later in-progress amendment before its first commit.",
  hc_decision: {
    task_scope: "harness-mc/acp-new-task-with-followup",
    hc_refs: ["#rightProblem"],
    hc_reasoning: "Fixture proves append-only history supports create followed by a same-diff amendment.",
    hc_confidence: 0.8,
    evidence_refs: ["milestones/harness-mc/tasks.json"],
    source_boundary: "HC is a thinking check, not source of truth; tasks.json remains canonical."
  },
  jv32_route: { workflows: ["task-lifecycle"] },
  task_lifecycle: {
    route: "JV-32/task-lifecycle",
    history: [
      {
        operation: "create",
        from_status: null,
        to_status: "todo",
        reason: "Fixture creates the canonical task.",
        evidence_refs: ["milestones/harness-mc/tasks.json"],
        recorded_at: "2026-07-18"
      },
      {
        operation: "amend",
        from_status: "todo",
        to_status: "in_progress",
        reason: "Fixture records work beginning before the first commit.",
        evidence_refs: ["milestones/harness-mc/tasks.json"],
        recorded_at: "2026-07-18"
      }
    ]
  }
});
writeJson(path.join(repo, "milestones", "harness-mc", "tasks.json"), newTaskWithFollowupMutation);

const newTaskWithFollowupPass = run(["--changed-only", "--project", "harness-mc"]);
if (!newTaskWithFollowupPass.output.includes("Task validation OK")) {
  throw new Error("Expected a new task with append-only followup mutation to pass.");
}

function lifecycleEvent(operation, fromStatus, toStatus, extras = {}) {
  return {
    operation,
    from_status: fromStatus,
    to_status: toStatus,
    reason: `Fixture records a valid ${operation} lifecycle event.`,
    evidence_refs: ["milestones/harness-mc/tasks.json"],
    recorded_at: "2026-07-18",
    ...extras,
  };
}

function semanticIntake(outcome, { comparedTaskRefs = [], replacesTaskRefs = [] } = {}) {
  return {
    outcome,
    compared_task_refs: comparedTaskRefs,
    scope_comparison: {
      problem: "Compared the problem being solved.",
      owner_source_of_truth: "Compared the canonical owner and source of truth.",
      inputs_outputs: "Compared inputs and outputs.",
      lifecycle_completion: "Compared lifecycle and completion boundaries.",
    },
    decision_reason: `Fixture records the ${outcome} semantic intake decision.`,
    approval: {
      status: "approved",
      approved_by: "Vincent",
      approved_at: "2026-07-19",
      evidence_refs: ["current-session: approved task mutation fixture"],
    },
    ...(replacesTaskRefs.length > 0 ? { replaces_task_refs: replacesTaskRefs } : {}),
  };
}

function weeklyCoreReview(decision, {
  previousReviewDate,
  nextReviewDate,
  newScope,
} = {}) {
  return {
    decision,
    approved_by: "Vincent",
    approved_at: "2026-07-19",
    evidence_refs: ["current-session: approved weekly core fixture"],
    ...(previousReviewDate ? { previous_review_date: previousReviewDate } : {}),
    ...(nextReviewDate ? { next_review_date: nextReviewDate } : {}),
    ...(newScope ? { new_scope: newScope } : {}),
  };
}

function lifecycleTask(id, status, history, workflows = ["task-lifecycle"]) {
  return {
    id,
    title: `生命週期 ${id}`,
    status,
    track: "control-plane",
    order_label: `ACP-${id.toUpperCase()}`,
    done_condition: "Fixture validates a legal governed task lifecycle transition.",
    hc_decision: {
      task_scope: `harness-mc/${id}`,
      hc_refs: ["#rightProblem"],
      hc_reasoning: "Fixture validates a legal lifecycle operation without bypassing canonical task state.",
      hc_confidence: 0.8,
      evidence_refs: ["milestones/harness-mc/tasks.json"],
      source_boundary: "HC is a thinking check, not source of truth; tasks.json remains canonical."
    },
    jv32_route: { workflows },
    task_lifecycle: { route: "JV-32/task-lifecycle", history }
  };
}

function morrowiseTask(id, status, history, extras = {}) {
  return {
    ...lifecycleTask(id, status, history),
    track: "governance",
    order_label: `JV-${id.toUpperCase()}`,
    ...extras,
  };
}

function morrowiseSeedTask() {
  return {
    id: "morrowise-seed-task",
    title: "MorroWise 種子任務",
    status: "todo",
    track: "governance",
    order_label: "JV-VERIFY-00",
    done_condition: "Seed task validates MorroWise project routing.",
    hc_decision: {
      task_scope: "morrowise/seed",
      hc_refs: ["#rightProblem"],
      hc_reasoning: "Fixture keeps MorroWise task validation active.",
      hc_confidence: 0.7,
      evidence_refs: ["milestones/morrowise/tasks.json"],
      source_boundary: "HC is a thinking check, not source of truth; tasks.json remains canonical."
    }
  };
}

const allLegalLifecycleOperations = structuredClone(baseTasks);
allLegalLifecycleOperations.tasks.push(
  lifecycleTask("create-amend", "todo", [
    lifecycleEvent("create", null, "todo"),
    lifecycleEvent("amend", "todo", "todo"),
  ]),
  lifecycleTask("suspend", "deferred", [
    lifecycleEvent("create", null, "todo"),
    lifecycleEvent("suspend", "todo", "deferred", { reactivation_criteria: "Required upstream evidence is available." }),
  ]),
  lifecycleTask("resume", "in_progress", [
    lifecycleEvent("create", null, "todo"),
    lifecycleEvent("suspend", "todo", "deferred", { reactivation_criteria: "Required upstream evidence is available." }),
    lifecycleEvent("resume", "deferred", "in_progress"),
  ]),
  lifecycleTask("complete", "completed", [
    lifecycleEvent("create", null, "todo"),
    lifecycleEvent("complete", "todo", "completed"),
  ], ["task-lifecycle", "closeout-commit-routing"]),
  lifecycleTask("cancel", "cancelled", [
    lifecycleEvent("create", null, "todo"),
    lifecycleEvent("cancel", "todo", "cancelled", { no_replacement_reason: "Fixture work is no longer needed." }),
  ]),
  lifecycleTask("archive", "archived", [
    lifecycleEvent("create", null, "todo"),
    lifecycleEvent("archive", "todo", "archived", { superseded_by: "acp-create-amend" }),
  ]),
);
writeJson(path.join(repo, "milestones", "harness-mc", "tasks.json"), allLegalLifecycleOperations);

const allLegalLifecycleOperationsPass = run(["--changed-only", "--project", "harness-mc"]);
if (!allLegalLifecycleOperationsPass.output.includes("Task validation OK")) {
  throw new Error("Expected create, amend, suspend, resume, complete, cancel, and archive fixtures to pass.");
}

const semanticIntakeMissing = {
  tasks: [
    morrowiseSeedTask(),
    morrowiseTask("semantic-intake-missing", "todo", [
      lifecycleEvent("create", null, "todo"),
    ]),
  ],
};
writeJson(path.join(repo, "milestones", "morrowise", "tasks.json"), semanticIntakeMissing);

const missingSemanticIntake = run(["--changed-only", "--project", "morrowise", "--as-of", "2026-07-19"], { expectFailure: true });
if (!missingSemanticIntake.output.includes("semantic_intake is required for a MorroWise semantic task mutation")) {
  throw new Error("Expected missing semantic task intake error.");
}

const semanticReuseMutation = {
  tasks: [
    morrowiseSeedTask(),
    morrowiseTask("semantic-reuse-mutation", "todo", [
      lifecycleEvent("create", null, "todo", {
        semantic_intake: semanticIntake("reuse", {
          comparedTaskRefs: ["morrowise/morrowise-seed-task"],
        }),
      }),
    ]),
  ],
};
writeJson(path.join(repo, "milestones", "morrowise", "tasks.json"), semanticReuseMutation);

const reuseMutation = run(["--changed-only", "--project", "morrowise", "--as-of", "2026-07-19"], { expectFailure: true });
if (!reuseMutation.output.includes("semantic_intake.outcome reuse is read-only and must not mutate canonical task state")) {
  throw new Error("Expected reuse mutation hard-fail.");
}

const semanticCreateAsAmend = {
  tasks: [
    morrowiseSeedTask(),
    morrowiseTask("semantic-create-as-amend", "todo", [
      lifecycleEvent("create", null, "todo", {
        semantic_intake: semanticIntake("amend", {
          comparedTaskRefs: ["morrowise/morrowise-seed-task"],
        }),
      }),
    ]),
  ],
};
writeJson(path.join(repo, "milestones", "morrowise", "tasks.json"), semanticCreateAsAmend);

const createAsAmend = run(["--changed-only", "--project", "morrowise", "--as-of", "2026-07-19"], { expectFailure: true });
if (!createAsAmend.output.includes("new MorroWise tasks require semantic_intake.outcome genuinely_new or replace")) {
  throw new Error("Expected create outcome mapping error.");
}

const semanticSelfOnlyComparison = {
  tasks: [
    morrowiseSeedTask(),
    morrowiseTask("semantic-self-only", "todo", [
      lifecycleEvent("create", null, "todo", {
        semantic_intake: semanticIntake("genuinely_new", {
          comparedTaskRefs: ["morrowise/semantic-self-only"],
        }),
      }),
    ]),
  ],
};
writeJson(path.join(repo, "milestones", "morrowise", "tasks.json"), semanticSelfOnlyComparison);

const selfOnlyComparison = run(["--changed-only", "--project", "morrowise", "--as-of", "2026-07-19"], { expectFailure: true });
if (!selfOnlyComparison.output.includes("semantic_intake.compared_task_refs must include at least one other canonical task")) {
  throw new Error("Expected a self-only semantic intake comparison to fail.");
}

const dualWeeklyCore = {
  tasks: [
    morrowiseSeedTask(),
    morrowiseTask("weekly-core-a", "in_progress", [
      lifecycleEvent("create", null, "in_progress", {
        semantic_intake: semanticIntake("genuinely_new", {
          comparedTaskRefs: ["morrowise/morrowise-seed-task"],
        }),
        weekly_core_review: weeklyCoreReview("admit", { nextReviewDate: "2026-07-26" }),
      }),
    ], { weekly_core: true, review_date: "2026-07-26" }),
    morrowiseTask("weekly-core-b", "in_progress", [
      lifecycleEvent("create", null, "in_progress", {
        semantic_intake: semanticIntake("genuinely_new", {
          comparedTaskRefs: ["morrowise/weekly-core-a"],
        }),
        weekly_core_review: weeklyCoreReview("admit", { nextReviewDate: "2026-07-27" }),
      }),
    ], { weekly_core: true, review_date: "2026-07-27" }),
  ],
};
writeJson(path.join(repo, "milestones", "morrowise", "tasks.json"), dualWeeklyCore);

const dualWeeklyCoreResult = run(["--changed-only", "--project", "morrowise", "--as-of", "2026-07-19"], { expectFailure: true });
if (!dualWeeklyCoreResult.output.includes("at most one MorroWise task may have weekly_core=true")) {
  throw new Error("Expected single weekly core WIP error.");
}

const weeklyCoreBaseline = {
  tasks: [
    morrowiseSeedTask(),
    morrowiseTask("weekly-core-review", "in_progress", [
      lifecycleEvent("create", null, "in_progress", {
        semantic_intake: semanticIntake("genuinely_new", {
          comparedTaskRefs: ["morrowise/morrowise-seed-task"],
        }),
        weekly_core_review: weeklyCoreReview("admit", { nextReviewDate: "2026-07-25" }),
      }),
    ], { weekly_core: true, review_date: "2026-07-25" }),
  ],
};
writeJson(path.join(repo, "milestones", "morrowise", "tasks.json"), weeklyCoreBaseline);
git(["add", "milestones/morrowise/tasks.json"]);
git(["commit", "-m", "seed weekly core review fixture"]);

const overdueWeeklyCore = structuredClone(weeklyCoreBaseline);
const overdueWeeklyCoreTask = overdueWeeklyCore.tasks.find((task) => task.id === "weekly-core-review");
overdueWeeklyCoreTask.note = "Fixture keeps an overdue weekly core task in progress.";
overdueWeeklyCoreTask.task_lifecycle.history.push(lifecycleEvent("amend", "in_progress", "in_progress", {
  semantic_intake: semanticIntake("amend", {
    comparedTaskRefs: ["morrowise/morrowise-seed-task"],
  }),
}));
writeJson(path.join(repo, "milestones", "morrowise", "tasks.json"), overdueWeeklyCore);

const overdueWeeklyCoreResult = run(["--changed-only", "--project", "morrowise", "--as-of", "2026-07-25"], { expectFailure: true });
if (!overdueWeeklyCoreResult.output.includes("weekly_core review_date has arrived; choose reframe, suspend, cancel, or complete")) {
  throw new Error("Expected overdue weekly core hard-fail.");
}

const automaticReviewExtension = structuredClone(weeklyCoreBaseline);
const automaticReviewExtensionTask = automaticReviewExtension.tasks.find((task) => task.id === "weekly-core-review");
automaticReviewExtensionTask.review_date = "2026-08-01";
automaticReviewExtensionTask.task_lifecycle.history.push(lifecycleEvent("amend", "in_progress", "in_progress", {
  semantic_intake: semanticIntake("amend", {
    comparedTaskRefs: ["morrowise/morrowise-seed-task"],
  }),
}));
writeJson(path.join(repo, "milestones", "morrowise", "tasks.json"), automaticReviewExtension);

const automaticReviewExtensionResult = run(["--changed-only", "--project", "morrowise", "--as-of", "2026-07-24"], { expectFailure: true });
if (!automaticReviewExtensionResult.output.includes("review_date changes require weekly_core_review.decision reframe with renewed Vincent approval")) {
  throw new Error("Expected automatic review date extension error.");
}

const approvedReframe = structuredClone(automaticReviewExtension);
approvedReframe.tasks.find((task) => task.id === "weekly-core-review").task_lifecycle.history.at(-1).weekly_core_review = weeklyCoreReview("reframe", {
  previousReviewDate: "2026-07-25",
  nextReviewDate: "2026-08-01",
  newScope: "Finish the deterministic semantic intake and weekly core enforcement contract.",
});
writeJson(path.join(repo, "milestones", "morrowise", "tasks.json"), approvedReframe);

const approvedReframeResult = run(["--changed-only", "--project", "morrowise", "--as-of", "2026-07-24"]);
if (!approvedReframeResult.output.includes("Task validation OK")) {
  throw new Error("Expected an explicitly approved weekly core reframe to pass.");
}

const weeklyCoreCompleteWithoutReview = structuredClone(weeklyCoreBaseline);
const weeklyCoreCompleteWithoutReviewTask = weeklyCoreCompleteWithoutReview.tasks.find((task) => task.id === "weekly-core-review");
weeklyCoreCompleteWithoutReviewTask.status = "completed";
weeklyCoreCompleteWithoutReviewTask.weekly_core = false;
delete weeklyCoreCompleteWithoutReviewTask.review_date;
weeklyCoreCompleteWithoutReviewTask.jv32_route.workflows.push("closeout-commit-routing");
weeklyCoreCompleteWithoutReviewTask.architecture_decision = {
  decision: "not_required",
  evaluated_at: "2026-07-19",
  reason: "Fixture completion does not create or change a reusable architecture subsystem.",
};
weeklyCoreCompleteWithoutReviewTask.task_lifecycle.history.push(lifecycleEvent("complete", "in_progress", "completed", {
  semantic_intake: semanticIntake("amend", {
    comparedTaskRefs: ["morrowise/morrowise-seed-task"],
  }),
}));
writeJson(path.join(repo, "milestones", "morrowise", "tasks.json"), weeklyCoreCompleteWithoutReview);

const weeklyCoreCompleteWithoutReviewResult = run(["--changed-only", "--project", "morrowise", "--as-of", "2026-07-24"], { expectFailure: true });
if (!weeklyCoreCompleteWithoutReviewResult.output.includes("weekly_core_review.decision complete with renewed Vincent approval is required")) {
  throw new Error("Expected weekly core completion without explicit Vincent approval to fail.");
}

const approvedWeeklyCoreComplete = structuredClone(weeklyCoreCompleteWithoutReview);
approvedWeeklyCoreComplete.tasks.find((task) => task.id === "weekly-core-review").task_lifecycle.history.at(-1).weekly_core_review = weeklyCoreReview("complete");
writeJson(path.join(repo, "milestones", "morrowise", "tasks.json"), approvedWeeklyCoreComplete);

const approvedWeeklyCoreCompleteWithStaleDate = structuredClone(approvedWeeklyCoreComplete);
approvedWeeklyCoreCompleteWithStaleDate.tasks.find((task) => task.id === "weekly-core-review").review_date = "2026-07-25";
writeJson(path.join(repo, "milestones", "morrowise", "tasks.json"), approvedWeeklyCoreCompleteWithStaleDate);

const approvedWeeklyCoreCompleteWithStaleDateResult = run(["--changed-only", "--project", "morrowise", "--as-of", "2026-07-24"], { expectFailure: true });
if (!approvedWeeklyCoreCompleteWithStaleDateResult.output.includes("review_date is only allowed when weekly_core=true")) {
  throw new Error("Expected a completed weekly core with a stale review_date to fail.");
}

writeJson(path.join(repo, "milestones", "morrowise", "tasks.json"), approvedWeeklyCoreComplete);
const approvedWeeklyCoreCompleteResult = run(["--changed-only", "--project", "morrowise", "--as-of", "2026-07-24"]);
if (!approvedWeeklyCoreCompleteResult.output.includes("Task validation OK")) {
  throw new Error("Expected an explicitly approved weekly core completion to pass.");
}

const traditionalChineseTitlePass = structuredClone(allLegalLifecycleOperations);
const traditionalChineseTitleTask = lifecycleTask("traditional-title-pass", "todo", [
  lifecycleEvent("create", null, "todo"),
]);
traditionalChineseTitleTask.title = "對話驅動 Prototype 生成流程可行性驗證";
const mixedTechnicalTitleTask = lifecycleTask("mixed-technical-title-pass", "todo", [
  lifecycleEvent("create", null, "todo"),
]);
mixedTechnicalTitleTask.title = "Paper Shader 轉接層與語意預設驗證";
traditionalChineseTitlePass.tasks.push(traditionalChineseTitleTask, mixedTechnicalTitleTask);
writeJson(path.join(repo, "milestones", "harness-mc", "tasks.json"), traditionalChineseTitlePass);

const traditionalChineseTitleResult = run(["--changed-only", "--project", "harness-mc"]);
if (!traditionalChineseTitleResult.output.includes("Task validation OK")) {
  throw new Error("Expected a Traditional Chinese title with immutable Prototype identifier to pass.");
}

const englishOnlyTitleRejected = structuredClone(allLegalLifecycleOperations);
const englishOnlyTitleTask = lifecycleTask("english-title-rejected", "todo", [
  lifecycleEvent("create", null, "todo"),
]);
englishOnlyTitleTask.title = "Conversation-to-Prototype Runtime Spike";
const mixedTechnicalEnglishTitleTask = lifecycleTask("mixed-technical-english-title-rejected", "todo", [
  lifecycleEvent("create", null, "todo"),
]);
mixedTechnicalEnglishTitleTask.title = "Paper Shader Integration";
englishOnlyTitleRejected.tasks.push(englishOnlyTitleTask, mixedTechnicalEnglishTitleTask);
writeJson(path.join(repo, "milestones", "harness-mc", "tasks.json"), englishOnlyTitleRejected);

const englishOnlyTitleResult = run(["--changed-only", "--project", "harness-mc"], { expectFailure: true });
if (!englishOnlyTitleResult.output.includes("title must use Traditional Chinese as the primary language; immutable technical identifiers may remain in the original language")) {
  throw new Error("Expected an all-English canonical task title to fail.");
}

const invalidPlanningReviewWindow = structuredClone(baseTasks);
const invalidPlanningReviewWindowTask = invalidPlanningReviewWindow.tasks.find((task) => task.id === "review-window-base");
invalidPlanningReviewWindowTask.execution_contract = {
  owner: "harness-mc/review-window-base",
  source_of_truth: "milestones/harness-mc/tasks.json#review-window-base",
  inputs: ["canonical task"],
  outputs: ["verified task contract"],
  verifiers: ["node scripts/validate-tasks.mjs --changed-only --project harness-mc"],
  stop_condition: "Missing contract evidence blocks completion.",
  review_window: {
    kind: "planning_checkpoint",
    planned_review_date: "not-a-date",
    trigger: ["scope_changed"],
    review_owner: "Vincent",
    allowed_outcomes: ["retain", "reframe", "defer"],
    enforcement: "informational_only",
    does_not_change_weekly_core: true,
  },
};
invalidPlanningReviewWindowTask.task_lifecycle.history.push(lifecycleEvent("amend", "todo", "todo"));
writeJson(path.join(repo, "milestones", "harness-mc", "tasks.json"), invalidPlanningReviewWindow);

const invalidPlanningReviewWindowResult = run(["--changed-only", "--project", "harness-mc"], { expectFailure: true });
if (!invalidPlanningReviewWindowResult.output.includes("execution_contract.review_window.planned_review_date must be YYYY-MM-DD")) {
  throw new Error("Expected an invalid planning review date to fail.");
}

const validPlanningReviewWindow = structuredClone(invalidPlanningReviewWindow);
validPlanningReviewWindow.tasks.find((task) => task.id === "review-window-base").execution_contract.review_window.planned_review_date = "2026-07-29";
writeJson(path.join(repo, "milestones", "harness-mc", "tasks.json"), validPlanningReviewWindow);

const validPlanningReviewWindowResult = run(["--changed-only", "--project", "harness-mc"]);
if (!validPlanningReviewWindowResult.output.includes("Task validation OK")) {
  throw new Error("Expected a valid planning review window to pass without changing weekly-core state.");
}

const legacyNotionCourseMirror = {
  tasks: [
    {
      id: "notion-aaaaaaaaaaaa",
      title: "第一門舊課程",
      status: "deferred",
      track: "course",
    },
    {
      id: "notion-aaaaaaaaaaaa",
      title: "第二門舊課程",
      status: "deferred",
      track: "course",
    },
  ],
};
writeJson(path.join(repo, "milestones", "self-learning", "tasks.json"), legacyNotionCourseMirror);

const duplicateNotionCourseMirrorResult = run(["--project", "self-learning"], { expectFailure: true });
if (!duplicateNotionCourseMirrorResult.output.includes("duplicate task id notion-aaaaaaaaaaaa")) {
  throw new Error("Expected duplicate Notion mirror task IDs to fail validation explicitly.");
}

git(["add", "milestones/self-learning/tasks.json"]);
git(["commit", "-m", "seed legacy Notion course mirror collision"]);

const repairedNotionCourseMirror = {
  tasks: [
    {
      id: "notion-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1",
      title: "第一門舊課程",
      status: "deferred",
      track: "course",
      done_condition: "依 Notion 課程總表追蹤第一門課程完成。",
      source_ref: {
        system: "Notion",
        page_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1",
      },
      mirror_note: "Notion remains source of truth; this task is an MC mirror.",
    },
    {
      id: "notion-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2",
      title: "第二門舊課程",
      status: "deferred",
      track: "course",
      done_condition: "依 Notion 課程總表追蹤第二門課程完成。",
      source_ref: {
        system: "Notion",
        page_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2",
      },
      mirror_note: "Notion remains source of truth; this task is an MC mirror.",
    },
  ],
};
writeJson(path.join(repo, "milestones", "self-learning", "tasks.json"), repairedNotionCourseMirror);

const repairedNotionCourseMirrorResult = run(["--changed-only", "--project", "self-learning"]);
if (!repairedNotionCourseMirrorResult.output.includes("Task validation OK")) {
  throw new Error("Expected a Notion course mirror ID repair to bypass canonical task deletion and lifecycle gates.");
}

const overdueMorrowiseBaseline = structuredClone(weeklyCoreBaseline);
writeJson(path.join(repo, "milestones", "morrowise", "tasks.json"), overdueMorrowiseBaseline);
writeJson(path.join(repo, "milestones", "rrrealll-ocr", "tasks.json"), {
  project: "rrrealll-ocr",
  tasks: [{
    id: "rrrealll-valid-baseline",
    title: "RRREALLL 合格基準任務",
    status: "todo",
    track: "product",
    done_condition: "Fixture establishes a valid RRREALLL task baseline.",
  }],
});
git(["add", "milestones"]);
git(["commit", "-m", "seed overdue MorroWise and RRREALLL isolation fixture"]);

const rrrealllOnlyChange = {
  project: "rrrealll-ocr",
  tasks: [
    {
      id: "rrrealll-valid-baseline",
      title: "RRREALLL 合格基準任務",
      status: "todo",
      track: "product",
      done_condition: "Fixture establishes a valid RRREALLL task baseline.",
    },
    {
      id: "rrrealll-valid-change",
      title: "RRREALLL 合格變更任務",
      status: "todo",
      track: "product",
      done_condition: "An unrelated project change must not inherit MorroWise lifecycle deadlines.",
      jv32_route: { workflows: ["task-lifecycle"] },
      task_lifecycle: {
        route: "JV-32/task-lifecycle",
        history: [{
          operation: "create",
          from_status: null,
          to_status: "todo",
          reason: "Fixture creates a governed RRREALLL task to test cross-project deadline isolation.",
          evidence_refs: ["milestones/rrrealll-ocr/tasks.json"],
          recorded_at: "2026-07-25",
        }],
      },
    },
  ],
};
writeJson(path.join(repo, "milestones", "rrrealll-ocr", "tasks.json"), rrrealllOnlyChange);

const unrelatedProjectWithOverdueMorrowise = run(["--changed-only", "--as-of", "2026-07-25"]);
if (!unrelatedProjectWithOverdueMorrowise.output.includes("Task validation OK")) {
  throw new Error("Expected a RRREALLL-only change to ignore an unchanged overdue MorroWise weekly core.");
}

const rrrealllIsolationBase = git(["rev-parse", "HEAD"]).trim();
git(["add", "milestones/rrrealll-ocr/tasks.json"]);
git(["commit", "-m", "commit valid RRREALLL-only change"]);

const cleanCommittedRrrealllChange = run([
  "--changed-only",
  "--base",
  rrrealllIsolationBase,
  "--as-of",
  "2026-07-25",
]);
if (!cleanCommittedRrrealllChange.output.includes("Task validation OK")) {
  throw new Error("Expected a clean committed RRREALLL-only diff to pass base-to-HEAD validation.");
}

const invalidCommittedRrrealllChange = structuredClone(rrrealllOnlyChange);
invalidCommittedRrrealllChange.tasks.push({
  id: "rrrealll-invalid-committed-change",
  title: "RRREALLL 無效提交任務",
  status: "todo",
  track: "product",
});
writeJson(path.join(repo, "milestones", "rrrealll-ocr", "tasks.json"), invalidCommittedRrrealllChange);
git(["add", "milestones/rrrealll-ocr/tasks.json"]);
git(["commit", "-m", "commit invalid RRREALLL-only change"]);

const invalidCleanCommittedRrrealllChange = run([
  "--changed-only",
  "--base",
  "HEAD~1",
  "--as-of",
  "2026-07-25",
], { expectFailure: true });
if (!invalidCleanCommittedRrrealllChange.output.includes("ERROR milestones/rrrealll-ocr/tasks.json task=rrrealll-invalid-committed-change")) {
  throw new Error("Expected base-to-HEAD validation to catch an invalid committed RRREALLL task.");
}
if (invalidCleanCommittedRrrealllChange.output.includes("ERROR milestones/morrowise/tasks.json")) {
  throw new Error("Committed RRREALLL validation must not inherit unchanged MorroWise lifecycle errors.");
}

const invalidBaseRef = run(["--base", "missing-validation-base"], { expectFailure: true });
if (!invalidBaseRef.output.includes("--base must resolve to a commit")) {
  throw new Error("Expected an invalid validation base ref to fail closed.");
}

console.log("validate-tasks verification OK");
