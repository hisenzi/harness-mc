import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "validate-tasks-"));
const repo = path.join(tmpRoot, "repo");
const script = path.resolve("scripts", "validate-tasks.mjs");

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
      title: "Good ACP task",
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
      title: "Legacy missing fields",
      status: "todo",
    },
  ],
};

writeJson(path.join(repo, "milestones", "harness-mc", "tasks.json"), baseTasks);
writeJson(path.join(repo, "milestones", "morrowise", "tasks.json"), {
  tasks: [
    {
      id: "morrowise-seed-task",
      title: "Seed MorroWise task",
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
    }
  ]
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

const changedTasks = structuredClone(baseTasks);
changedTasks.tasks.push({
  id: "acp-bad-task",
  title: "Bad ACP task",
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
  title: "Malformed HC task",
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

const closedWithoutArchitectureDecision = {
  tasks: [
    {
      id: "morrowise-closed-without-arch",
      title: "Closed without architecture decision",
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
            recorded_at: "2026-07-18"
          }
        ]
      }
    }
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
  title: "Lifecycle route missing",
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
  title: "Lifecycle history missing",
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
  title: "New task with followup mutation",
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

function lifecycleTask(id, status, history, workflows = ["task-lifecycle"]) {
  return {
    id,
    title: `Lifecycle ${id}`,
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

console.log("validate-tasks verification OK");
