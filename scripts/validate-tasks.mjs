import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.HARNESS_MC_ROOT
  ? path.resolve(process.env.HARNESS_MC_ROOT)
  : path.resolve(__dirname, "..");
const milestonesDir = path.join(root, "milestones");

const VALID_STATUSES = new Set([
  "todo",
  "not_started",
  "in_progress",
  "blocked",
  "done",
  "completed",
  "fixed",
  "deferred",
  "archived",
  "cancelled",
]);
const ACTIVE_STATUSES = new Set(["todo", "in_progress", "doing", "blocked"]);
const CLOSED_STATUSES = new Set(["done", "completed", "fixed"]);
const ARCHITECTURE_DECISIONS = new Set(["promoted", "not_required", "deferred"]);
const ARCHITECTURE_ADMISSION_REVIEW_SCOPES = new Set(["version_improvement"]);
const ARCHITECTURE_ADMISSION_INDEX_ACTIONS = new Set(["updated", "no_index_change"]);
const ARCHITECTURE_SYNC_CHECK_REF = "python3 \"$COLLAB/notyet-harness/000_Agent/scripts/sync-architecture-subsystems.py\" --check";
const ARCHITECTURE_GATE_TRACKS = new Set(["governance", "runtime-delivery", "auditor-mvp"]);
const TASK_LIFECYCLE_OPERATIONS = new Set(["create", "amend", "suspend", "resume", "complete", "cancel", "archive"]);
const SEMANTIC_INTAKE_OUTCOMES = new Set(["reuse", "amend", "replace", "genuinely_new"]);
const SEMANTIC_SCOPE_FIELDS = ["problem", "owner_source_of_truth", "inputs_outputs", "lifecycle_completion"];
const WEEKLY_CORE_REVIEW_DECISIONS = new Set(["admit", "reframe", "suspend", "cancel", "complete"]);
const PLANNING_REVIEW_OUTCOMES = new Set(["retain", "reframe", "defer"]);
const BOOKKEEPING_ONLY_FIELDS = new Set(["commits", "completed_at", "summary", "external_refs", "execution_contract", "jv32_route", "task_lifecycle"]);
const HAN_SCRIPT_PATTERN = /\p{Script=Han}/u;

function parseArgs(argv) {
  const args = {
    changedOnly: false,
    projects: new Set(),
    tracks: new Set(),
    asOf: todayInTaipei(),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--changed-only") {
      args.changedOnly = true;
    } else if (arg === "--project") {
      args.projects.add(argv[++i]);
    } else if (arg === "--track") {
      args.tracks.add(argv[++i]);
    } else if (arg === "--as-of") {
      args.asOf = argv[++i];
      if (!isDateOnly(args.asOf)) throw new Error(`--as-of must be YYYY-MM-DD, got: ${args.asOf}`);
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function usage() {
  return [
    "Usage: node scripts/validate-tasks.mjs [--changed-only] [--project <id>] [--track <id>] [--as-of YYYY-MM-DD]",
    "",
    "Validates milestone task schema without making historical legacy data fatal.",
    "Changed/new control-plane and MorroWise tasks fail; historical issues warn.",
  ].join("\n");
}

function runGit(args, { allowFail = false } = {}) {
  try {
    return execSync(`git ${args}`, {
      cwd: root,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch (error) {
    if (allowFail) return "";
    throw error;
  }
}

function quoteShell(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8").replace(/^﻿/, ""));
}

function listProjectDirs() {
  if (!fs.existsSync(milestonesDir)) return [];
  return fs.readdirSync(milestonesDir)
    .sort()
    .filter((name) => fs.existsSync(path.join(milestonesDir, name, "tasks.json")));
}

function getChangedTaskFiles() {
  const files = new Set();
  const tracked = runGit("diff --name-only HEAD -- milestones", { allowFail: true });
  const untracked = runGit("ls-files --others --exclude-standard -- milestones", { allowFail: true });

  for (const file of `${tracked}\n${untracked}`.split("\n").filter(Boolean)) {
    if (/^milestones\/[^/]+\/tasks\.json$/.test(file)) files.add(path.resolve(root, file));
  }

  return files;
}

function extractTasks(raw) {
  if (Array.isArray(raw)) return raw.map((task) => ({ task, container: "array" }));
  if (Array.isArray(raw.tasks)) return raw.tasks.map((task) => ({ task, container: "tasks" }));
  if (Array.isArray(raw.dev) || Array.isArray(raw.ops)) {
    return [
      ...(raw.dev || []).map((task) => ({ task, container: "dev" })),
      ...(raw.ops || []).map((task) => ({ task, container: "ops" })),
    ];
  }
  if (Array.isArray(raw.phases)) {
    const tasks = [];
    for (const phase of raw.phases) {
      for (const task of phase.tasks || []) {
        tasks.push({ task: { ...task, track: task.track || phase.id }, container: `phase:${phase.id || ""}` });
      }
    }
    return tasks;
  }
  return [];
}

function readHeadTasks(relFile) {
  const content = runGit(`show HEAD:${quoteShell(relFile)}`, { allowFail: true });
  if (!content) return new Map();
  try {
    const raw = JSON.parse(content.replace(/^﻿/, ""));
    return taskSnapshotMap(extractTasks(raw).map((entry) => entry.task));
  } catch {
    return new Map();
  }
}

function taskSnapshotMap(tasks) {
  const map = new Map();
  for (const task of tasks) {
    if (!task || typeof task !== "object" || !task.id) continue;
    map.set(String(task.id), task);
  }
  return map;
}

function isPortableAgentScope(task, project = "", includeProjectScope = false) {
  const id = String(task.id || "");
  const track = String(task.track || "");
  const label = String(task.order_label || "");
  return (includeProjectScope && project === "morrowise")
    || track === "control-plane"
    || track === "morrowise-system"
    || id.startsWith("acp-")
    || id.startsWith("morrowise-")
    || label.startsWith("ACP-")
    || label.startsWith("MC-LIVE-");
}

function isCurrentWriteScope({ task, changed, changedOnly, project = "" }) {
  return changedOnly && changed && isPortableAgentScope(task, project, true);
}

function validateTask(task, {
  project = "",
  changed = false,
  changedOnly = false,
  previousTask = null,
  canonicalTaskRefs = new Map(),
} = {}) {
  const problems = [];
  const includeProjectScope = !changedOnly || changed;

  if (!task || typeof task !== "object" || Array.isArray(task)) {
    return ["task must be an object"];
  }

  if (!nonEmptyString(task.id)) problems.push("id must be a non-empty string");
  if (!nonEmptyString(task.title)) {
    problems.push("title must be a non-empty string");
  } else if ((!changedOnly || changed) && !HAN_SCRIPT_PATTERN.test(task.title)) {
    problems.push("title must use Traditional Chinese as the primary language; immutable technical identifiers may remain in the original language");
  }
  if (!nonEmptyString(task.status)) {
    problems.push("status must be a non-empty string");
  } else if (!VALID_STATUSES.has(task.status)) {
    problems.push(`status has unknown value: ${task.status}`);
  }
  if (!nonEmptyString(task.track)) problems.push("track must be a non-empty string");
  if (!nonEmptyString(task.done_condition)) problems.push("done_condition must be a non-empty string");

  if ("depends_on" in task && !Array.isArray(task.depends_on)) {
    problems.push("depends_on must be an array when present");
  }
  if ("depends_on" in task && Array.isArray(task.depends_on)) {
    for (const dep of task.depends_on) {
      if (!nonEmptyString(dep)) problems.push("depends_on entries must be non-empty strings");
    }
  }

  if ("order_label" in task && task.order_label !== null && task.order_label !== "" && typeof task.order_label !== "string") {
    problems.push("order_label must be a string when present");
  }
  if (isPortableAgentScope(task, project, includeProjectScope) && !nonEmptyString(task.order_label)) {
    problems.push("order_label is required for control-plane / MorroWise tasks");
  }

  if ("external_refs" in task && (typeof task.external_refs !== "object" || task.external_refs === null || Array.isArray(task.external_refs))) {
    problems.push("external_refs must be an object when present");
  }
  if (requiresHcDecision(task, project, includeProjectScope) && !("hc_decision" in task)) {
    problems.push("hc_decision is required for active control-plane / MorroWise execution tasks");
  }
  if ("hc_decision" in task) {
    problems.push(...validateHcDecision(task.hc_decision));
  }
  if ("execution_contract" in task) {
    problems.push(...validateExecutionContract(task.execution_contract));
  }
  if (requiresTaskLifecycleRoute({ task, changed, changedOnly })) {
    problems.push(...validateTaskLifecycleRoute(task));
    problems.push(...validateTaskLifecycleEvidence(task, { previousTask }));
    if (project === "morrowise" && isSemanticTaskMutation(task, previousTask)) {
      problems.push(...validateSemanticTaskIntake(task, { previousTask, canonicalTaskRefs }));
    }
    if (project === "morrowise") {
      problems.push(...validateWeeklyCoreTransition(task, { previousTask }));
    }
  }
  if (requiresArchitectureDecision(task, project, includeProjectScope) && !("architecture_decision" in task)) {
    problems.push("architecture_decision is required before closing MorroWise governance/runtime-delivery/auditor-mvp tasks");
  }
  if ("architecture_decision" in task) {
    problems.push(...validateArchitectureDecision(task.architecture_decision));
  }

  return problems;
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validateExecutionContract(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return ["execution_contract must be an object when present"];
  }

  const problems = [];
  if (!nonEmptyString(value.owner)) problems.push("execution_contract.owner must be a non-empty string");
  if (!nonEmptyString(value.source_of_truth)) problems.push("execution_contract.source_of_truth must be a non-empty string");
  for (const field of ["inputs", "outputs", "verifiers"]) {
    if (!Array.isArray(value[field]) || value[field].length === 0 || value[field].some((entry) => !nonEmptyString(entry))) {
      problems.push(`execution_contract.${field} must be a non-empty array`);
    }
  }
  if (!nonEmptyString(value.stop_condition)) problems.push("execution_contract.stop_condition must be a non-empty string");
  if ("review_window" in value) {
    const reviewWindow = value.review_window;
    if (!reviewWindow || typeof reviewWindow !== "object" || Array.isArray(reviewWindow)) {
      problems.push("execution_contract.review_window must be an object when present");
    } else {
      if (reviewWindow.kind !== "planning_checkpoint") {
        problems.push("execution_contract.review_window.kind must be planning_checkpoint");
      }
      if (!isDateOnly(reviewWindow.planned_review_date)) {
        problems.push("execution_contract.review_window.planned_review_date must be YYYY-MM-DD");
      }
      if (!Array.isArray(reviewWindow.trigger) || reviewWindow.trigger.length === 0 || reviewWindow.trigger.some((entry) => !nonEmptyString(entry))) {
        problems.push("execution_contract.review_window.trigger must be a non-empty array");
      }
      if (!nonEmptyString(reviewWindow.review_owner)) {
        problems.push("execution_contract.review_window.review_owner must be a non-empty string");
      }
      if (!Array.isArray(reviewWindow.allowed_outcomes) || reviewWindow.allowed_outcomes.length === 0 || reviewWindow.allowed_outcomes.some((entry) => !PLANNING_REVIEW_OUTCOMES.has(entry))) {
        problems.push("execution_contract.review_window.allowed_outcomes must contain only retain, reframe, or defer");
      }
      if (reviewWindow.enforcement !== "informational_only") {
        problems.push("execution_contract.review_window.enforcement must be informational_only");
      }
      if (reviewWindow.does_not_change_weekly_core !== true) {
        problems.push("execution_contract.review_window.does_not_change_weekly_core must be true");
      }
    }
  }
  return problems;
}

function isDateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function todayInTaipei() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function requiresHcDecision(task, project = "", includeProjectScope = false) {
  return isPortableAgentScope(task, project, includeProjectScope) && ACTIVE_STATUSES.has(String(task.status || "todo").toLowerCase());
}

function requiresTaskLifecycleRoute({ task, changed, changedOnly }) {
  return changedOnly && changed && nonEmptyString(task.id);
}

function validateTaskLifecycleRoute(task) {
  if (!task.jv32_route || typeof task.jv32_route !== "object" || Array.isArray(task.jv32_route)) {
    return ["jv32_route is required for changed or new canonical task mutations"];
  }
  if (!Array.isArray(task.jv32_route.workflows) || !task.jv32_route.workflows.includes("task-lifecycle")) {
    return ["jv32_route.workflows must include task-lifecycle for changed or new canonical task mutations"];
  }
  return [];
}

function validateTaskLifecycleEvidence(task, { previousTask = null } = {}) {
  const problems = [];
  if (!task.task_lifecycle || typeof task.task_lifecycle !== "object" || Array.isArray(task.task_lifecycle)) {
    return ["task_lifecycle is required for changed or new canonical task mutations"];
  }
  if (task.task_lifecycle.route !== "JV-32/task-lifecycle") {
    problems.push("task_lifecycle.route must equal JV-32/task-lifecycle");
  }
  if (!Array.isArray(task.task_lifecycle.history) || task.task_lifecycle.history.length === 0) {
    return [...problems, "task_lifecycle.history must be a non-empty append-only array for changed or new canonical task mutations"];
  }

  const history = task.task_lifecycle.history;
  for (const [index, event] of history.entries()) {
    const prefix = `task_lifecycle.history[${index}]`;
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      problems.push(`${prefix} must be an object`);
      continue;
    }
    if (!TASK_LIFECYCLE_OPERATIONS.has(event.operation)) {
      problems.push(`${prefix}.operation must be create, amend, suspend, resume, complete, cancel, or archive`);
    }
    if (event.from_status !== null && !nonEmptyString(event.from_status)) {
      problems.push(`${prefix}.from_status must be a status string or null`);
    }
    if (!nonEmptyString(event.to_status)) {
      problems.push(`${prefix}.to_status must be a non-empty status string`);
    }
    if (!nonEmptyString(event.reason)) {
      problems.push(`${prefix}.reason must be a non-empty string`);
    }
    if (!Array.isArray(event.evidence_refs) || event.evidence_refs.length === 0 || event.evidence_refs.some((ref) => !nonEmptyString(ref))) {
      problems.push(`${prefix}.evidence_refs must be a non-empty string array`);
    }
    if (!nonEmptyString(event.recorded_at) || !/^\d{4}-\d{2}-\d{2}$/.test(event.recorded_at)) {
      problems.push(`${prefix}.recorded_at must be YYYY-MM-DD`);
    }
    if (event.operation === "suspend" && !nonEmptyString(event.reactivation_criteria)) {
      problems.push("deferred lifecycle event requires reactivation_criteria");
    }
    if (event.operation === "cancel" && !nonEmptyString(event.replacement_task_id) && !nonEmptyString(event.no_replacement_reason)) {
      problems.push("cancelled lifecycle event requires replacement_task_id or no_replacement_reason");
    }
    if (event.operation === "archive" && Object.hasOwn(event, "superseded_by") && !nonEmptyString(event.superseded_by)) {
      problems.push("archived lifecycle event superseded_by must be a non-empty task id when present");
    }
  }

  const last = history.at(-1);
  if (!last || typeof last !== "object" || Array.isArray(last)) return problems;

  if (last.to_status !== task.status) {
    problems.push("task_lifecycle.history last to_status must match task.status");
  }

  const previousHistory = previousTask?.task_lifecycle?.history;
  if (Array.isArray(previousHistory)) {
    if (history.length <= previousHistory.length) {
      problems.push("task_lifecycle.history must append a new event for every canonical task mutation");
    } else if (previousHistory.some((event, index) => JSON.stringify(event) !== JSON.stringify(history[index]))) {
      problems.push("task_lifecycle.history is append-only; prior events must not be rewritten");
    }
  }

  const previousStatus = previousTask?.status;
  if (!previousTask) {
    const first = history[0];
    if (!first || first.operation !== "create" || first.from_status !== null) {
      problems.push("new tasks require a first create lifecycle event with from_status null");
    }
  } else if (previousStatus !== task.status) {
    const expectedOperation = expectedLifecycleOperation(previousStatus, task.status);
    if (last.operation !== expectedOperation) {
      problems.push(`task status transition ${previousStatus} -> ${task.status} requires lifecycle operation ${expectedOperation}`);
    }
  } else if (last.operation !== "amend") {
    problems.push("task content mutations without a status change require lifecycle operation amend");
  }

  if (task.status === "deferred" && last.operation !== "suspend") {
    problems.push("deferred task lifecycle mutations require operation suspend");
  }
  if (task.status === "cancelled" && last.operation !== "cancel") {
    problems.push("cancelled task lifecycle mutations require operation cancel");
  }
  if (task.status === "archived" && last.operation !== "archive") {
    problems.push("archived task lifecycle mutations require operation archive");
  }
  const isCompletionTransition = CLOSED_STATUSES.has(task.status) && previousStatus !== task.status;
  if (isCompletionTransition && !task.jv32_route.workflows.includes("closeout-commit-routing")) {
    problems.push("completed task lifecycle mutations require jv32_route.workflows to include closeout-commit-routing");
  }
  if (isCompletionTransition) {
    problems.push(...validateCompletionTestContract(task.test_contract));
    problems.push(...validateCompletionEvidence(task.completion_evidence, { testContract: task.test_contract }));
  }

  return problems;
}

function validateCompletionTestContract(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return ["completed task lifecycle mutations require test_contract"];
  }

  const problems = [];
  if (!["required", "exempt"].includes(value.applicability)) {
    problems.push("completed task test_contract.applicability must be required or exempt");
  }
  for (const field of ["behavior_cases", "test_level", "fixture_refs", "evidence_refs"]) {
    if (!nonEmptyStringArray(value[field])) {
      problems.push(`completed task test_contract.${field} must be a non-empty string array`);
    }
  }
  if (typeof value.runtime_evidence_required !== "boolean") {
    problems.push("completed task test_contract.runtime_evidence_required must be a boolean");
  }
  if (value.applicability === "required") {
    for (const field of ["red_command", "expected_red_reason", "green_command"]) {
      if (!nonEmptyString(value[field])) {
        problems.push(`completed task test_contract.${field} must be a non-empty string`);
      }
    }
    if (!nonEmptyStringArray(value.full_regression_commands)) {
      problems.push("completed task test_contract.full_regression_commands must be a non-empty string array");
    }
  }
  if (value.applicability === "exempt") {
    if (!nonEmptyString(value.tdd_exemption_reason)) {
      problems.push("completed exempt task test_contract.tdd_exemption_reason must be a non-empty string");
    }
    if (!nonEmptyStringArray(value.alternative_verification_commands)) {
      problems.push("completed exempt task test_contract.alternative_verification_commands must be a non-empty string array");
    }
  }
  return problems;
}

function validateCompletionEvidence(value, { testContract = {} } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return ["completed task lifecycle mutations require completion_evidence"];
  }
  const problems = [];
  if (testContract.applicability === "required") {
    for (const field of ["red_evidence", "green_evidence"]) {
      if (!nonEmptyStringArray(value[field])) {
        problems.push(`completed task completion_evidence.${field} must be a non-empty string array`);
      }
    }
  }
  for (const field of ["regression_evidence", "verifier_refs"]) {
    if (!nonEmptyStringArray(value[field])) {
      problems.push(`completed task completion_evidence.${field} must be a non-empty string array`);
    }
  }
  if (!nonEmptyString(value.fixture_runtime_boundary)) {
    problems.push("completed task completion_evidence.fixture_runtime_boundary must be a non-empty string");
  }
  if (testContract.runtime_evidence_required === true && !nonEmptyStringArray(value.runtime_evidence)) {
    problems.push("completed runtime task completion_evidence.runtime_evidence must be a non-empty string array");
  }
  return problems;
}

function nonEmptyStringArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every((entry) => nonEmptyString(entry));
}

function expectedLifecycleOperation(previousStatus, nextStatus) {
  if (nextStatus === "deferred") return "suspend";
  if (nextStatus === "cancelled") return "cancel";
  if (nextStatus === "archived") return "archive";
  if (CLOSED_STATUSES.has(nextStatus)) return "complete";
  if (previousStatus === "deferred" || CLOSED_STATUSES.has(previousStatus)) return "resume";
  return "amend";
}

function isSemanticTaskMutation(task, previousTask) {
  if (!previousTask) return true;
  return JSON.stringify(semanticTaskSnapshot(task)) !== JSON.stringify(semanticTaskSnapshot(previousTask));
}

function semanticTaskSnapshot(task) {
  return Object.fromEntries(
    Object.entries(task || {}).filter(([field]) => !BOOKKEEPING_ONLY_FIELDS.has(field)),
  );
}

function validateSemanticTaskIntake(task, { previousTask, canonicalTaskRefs }) {
  const last = task.task_lifecycle?.history?.at(-1);
  const intake = last?.semantic_intake;
  const problems = [];

  if (!intake || typeof intake !== "object" || Array.isArray(intake)) {
    return ["semantic_intake is required for a MorroWise semantic task mutation"];
  }

  if (!SEMANTIC_INTAKE_OUTCOMES.has(intake.outcome)) {
    problems.push("semantic_intake.outcome must be reuse, amend, replace, or genuinely_new");
  }
  if (intake.outcome === "reuse") {
    problems.push("semantic_intake.outcome reuse is read-only and must not mutate canonical task state");
  }
  if (!previousTask && !["genuinely_new", "replace"].includes(intake.outcome)) {
    problems.push("new MorroWise tasks require semantic_intake.outcome genuinely_new or replace");
  }
  if (previousTask && intake.outcome !== "amend") {
    problems.push("existing MorroWise tasks require semantic_intake.outcome amend");
  }

  if (!Array.isArray(intake.compared_task_refs) || intake.compared_task_refs.length === 0) {
    problems.push("semantic_intake.compared_task_refs must be a non-empty canonical project/task-id array");
  } else {
    const selfRef = `morrowise/${task.id}`;
    if (intake.compared_task_refs.every((ref) => ref === selfRef)) {
      problems.push("semantic_intake.compared_task_refs must include at least one other canonical task");
    }
    for (const ref of intake.compared_task_refs) {
      if (!nonEmptyString(ref) || !canonicalTaskRefs.has(ref)) {
        problems.push(`semantic_intake.compared_task_refs contains unresolved canonical task ref: ${ref}`);
      }
    }
  }

  const scope = intake.scope_comparison;
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) {
    problems.push("semantic_intake.scope_comparison must compare four task boundaries");
  } else {
    for (const field of SEMANTIC_SCOPE_FIELDS) {
      if (!nonEmptyString(scope[field])) {
        problems.push(`semantic_intake.scope_comparison.${field} must be a non-empty string`);
      }
    }
  }

  if (!nonEmptyString(intake.decision_reason)) {
    problems.push("semantic_intake.decision_reason must be a non-empty string");
  }
  problems.push(...validateVincentApproval(intake.approval, "semantic_intake.approval", { requireStatus: true }));

  if (intake.outcome === "replace") {
    if (!Array.isArray(intake.replaces_task_refs) || intake.replaces_task_refs.length === 0) {
      problems.push("semantic_intake.replace requires replaces_task_refs");
    } else {
      for (const ref of intake.replaces_task_refs) {
        const replaced = canonicalTaskRefs.get(ref);
        if (!replaced) {
          problems.push(`semantic_intake.replaces_task_refs contains unresolved canonical task ref: ${ref}`);
        } else if (!["archived", "cancelled"].includes(String(replaced.status))) {
          problems.push(`semantic_intake.replace target must be archived or cancelled in the same canonical state: ${ref}`);
        }
      }
    }
  }

  return problems;
}

function validateVincentApproval(approval, prefix, { requireStatus = false } = {}) {
  const problems = [];
  if (!approval || typeof approval !== "object" || Array.isArray(approval)) {
    return [`${prefix} must record explicit Vincent approval`];
  }
  if (requireStatus && approval.status !== "approved") {
    problems.push(`${prefix}.status must equal approved`);
  }
  if (approval.approved_by !== "Vincent") {
    problems.push(`${prefix}.approved_by must equal Vincent`);
  }
  if (!isDateOnly(approval.approved_at)) {
    problems.push(`${prefix}.approved_at must be YYYY-MM-DD`);
  }
  if (!Array.isArray(approval.evidence_refs) || approval.evidence_refs.length === 0 || approval.evidence_refs.some((ref) => !nonEmptyString(ref))) {
    problems.push(`${prefix}.evidence_refs must be a non-empty string array`);
  }
  return problems;
}

function validateWeeklyCoreTransition(task, { previousTask }) {
  const problems = [];
  const previousCore = previousTask?.weekly_core === true;
  const currentCore = task.weekly_core === true;
  const last = task.task_lifecycle?.history?.at(-1);
  const review = last?.weekly_core_review;

  if (!previousCore && currentCore) {
    problems.push(...validateWeeklyCoreReview(review, {
      expectedDecision: "admit",
      nextReviewDate: task.review_date,
    }));
  }

  if (previousCore && currentCore && previousTask.review_date !== task.review_date) {
    if (review?.decision !== "reframe") {
      problems.push("review_date changes require weekly_core_review.decision reframe with renewed Vincent approval");
    } else {
      problems.push(...validateWeeklyCoreReview(review, {
        expectedDecision: "reframe",
        previousReviewDate: previousTask.review_date,
        nextReviewDate: task.review_date,
      }));
    }
  }

  if (previousCore && !currentCore) {
    if (task.status === "in_progress") {
      problems.push("an in_progress weekly core task cannot clear weekly_core without reframe, suspend, cancel, or complete");
    } else if (task.status === "deferred") {
      problems.push(...validateWeeklyCoreReview(review, { expectedDecision: "suspend" }));
    } else if (task.status === "cancelled") {
      problems.push(...validateWeeklyCoreReview(review, { expectedDecision: "cancel" }));
    } else if (CLOSED_STATUSES.has(task.status)) {
      problems.push(...validateWeeklyCoreReview(review, { expectedDecision: "complete" }));
    } else if (!CLOSED_STATUSES.has(task.status)) {
      problems.push("leaving weekly_core requires deferred, cancelled, or completed status");
    }
  }

  return problems;
}

function validateWeeklyCoreReview(review, {
  expectedDecision,
  previousReviewDate,
  nextReviewDate,
} = {}) {
  const problems = [];
  if (!review || typeof review !== "object" || Array.isArray(review)) {
    return [`weekly_core_review.decision ${expectedDecision} with renewed Vincent approval is required`];
  }
  if (!WEEKLY_CORE_REVIEW_DECISIONS.has(review.decision)) {
    problems.push("weekly_core_review.decision must be admit, reframe, suspend, cancel, or complete");
  }
  if (review.decision !== expectedDecision) {
    problems.push(`weekly_core_review.decision must equal ${expectedDecision}`);
  }
  problems.push(...validateVincentApproval(review, "weekly_core_review"));

  if (["admit", "reframe"].includes(expectedDecision) && review.next_review_date !== nextReviewDate) {
    problems.push("weekly_core_review.next_review_date must match task.review_date");
  }
  if (expectedDecision === "reframe") {
    if (review.previous_review_date !== previousReviewDate) {
      problems.push("weekly_core_review.previous_review_date must match the prior review_date");
    }
    if (!nonEmptyString(review.new_scope)) {
      problems.push("weekly_core_review.new_scope is required for reframe");
    }
  }
  return problems;
}

function validateHcDecision(decision) {
  const problems = [];
  if (!decision || typeof decision !== "object" || Array.isArray(decision)) {
    return ["hc_decision must be an object when present"];
  }

  if (!nonEmptyString(decision.task_scope)) {
    problems.push("hc_decision.task_scope must be a non-empty string");
  }
  if (!Array.isArray(decision.evidence_refs) || decision.evidence_refs.length === 0) {
    problems.push("hc_decision.evidence_refs must be a non-empty array");
  } else {
    for (const ref of decision.evidence_refs) {
      if (!nonEmptyString(ref)) problems.push("hc_decision.evidence_refs entries must be non-empty strings");
    }
  }
  if (!nonEmptyString(decision.source_boundary)) {
    problems.push("hc_decision.source_boundary must explain that HC is a thinking check, not source of truth");
  } else if (!mentionsThinkingCheck(decision.source_boundary) || !mentionsSourceOfTruth(decision.source_boundary)) {
    problems.push("hc_decision.source_boundary must mention thinking check/source of truth or 思考檢查/正本");
  }

  const hasNotRequired = nonEmptyString(decision.not_required_reason);
  if (hasNotRequired) return problems;

  if (!Array.isArray(decision.hc_refs) || decision.hc_refs.length === 0) {
    problems.push("hc_decision.hc_refs must be a non-empty array unless not_required_reason is set");
  } else {
    for (const ref of decision.hc_refs) {
      if (!nonEmptyString(ref) || !ref.startsWith("#")) {
        problems.push("hc_decision.hc_refs entries must be HC refs like #risk");
      }
    }
  }
  if (!nonEmptyString(decision.hc_reasoning)) {
    problems.push("hc_decision.hc_reasoning must be a non-empty string unless not_required_reason is set");
  }
  if (typeof decision.hc_confidence !== "number" || decision.hc_confidence < 0 || decision.hc_confidence > 1) {
    problems.push("hc_decision.hc_confidence must be a number from 0 to 1 unless not_required_reason is set");
  }

  return problems;
}

function mentionsThinkingCheck(value) {
  return /thinking check/i.test(value) || /思考檢查|思考輔助/.test(value);
}

function mentionsSourceOfTruth(value) {
  return /source of truth/i.test(value) || /正本/.test(value);
}

function requiresArchitectureDecision(task, project, includeProjectScope = false) {
  return includeProjectScope
    && project === "morrowise"
    && CLOSED_STATUSES.has(String(task.status || "").toLowerCase())
    && ARCHITECTURE_GATE_TRACKS.has(String(task.track || ""));
}

function validateArchitectureDecision(decision) {
  const problems = [];
  if (!decision || typeof decision !== "object" || Array.isArray(decision)) {
    return ["architecture_decision must be an object when present"];
  }

  if (!ARCHITECTURE_DECISIONS.has(decision.decision)) {
    problems.push("architecture_decision.decision must be promoted, not_required, or deferred");
  }
  if (!nonEmptyString(decision.evaluated_at) || !/^\d{4}-\d{2}-\d{2}$/.test(decision.evaluated_at)) {
    problems.push("architecture_decision.evaluated_at must be YYYY-MM-DD");
  }
  if (decision.decision === "promoted") {
    if (!nonEmptyString(decision.registry_ref) && !nonEmptyString(decision.detail_doc)) {
      problems.push("architecture_decision promoted tasks need registry_ref or detail_doc");
    }
  } else if (!nonEmptyString(decision.reason)) {
    problems.push("architecture_decision not_required/deferred tasks need reason");
  }
  if ("admission_review" in decision) {
    problems.push(...validateArchitectureAdmissionReview(decision.admission_review));
  }

  return problems;
}

function validateArchitectureAdmissionReview(review) {
  const problems = [];
  if (!review || typeof review !== "object" || Array.isArray(review)) {
    return ["architecture_decision.admission_review must be an object when present"];
  }
  if (!ARCHITECTURE_ADMISSION_REVIEW_SCOPES.has(review.scope)) {
    problems.push("architecture_decision.admission_review.scope must be version_improvement");
  }
  if (!nonEmptyString(review.admission_record_ref) || !/^\$COLLAB\/harness-mc\/system-workflow\/registries\/morrowise-architecture-subsystems\.json#[A-Za-z0-9._-]+$/.test(review.admission_record_ref)) {
    problems.push("architecture_decision.admission_review.admission_record_ref must be a MorroWise Architecture Admission Record ref");
  }
  if (!ARCHITECTURE_ADMISSION_INDEX_ACTIONS.has(review.index_action)) {
    problems.push("architecture_decision.admission_review.index_action must be updated or no_index_change");
  }
  if (review.sync_check_ref !== ARCHITECTURE_SYNC_CHECK_REF) {
    problems.push("architecture_decision.admission_review.sync_check_ref must reference the controlled architecture sync check");
  }
  if (!Array.isArray(review.evidence_refs) || review.evidence_refs.length === 0 || review.evidence_refs.some((ref) => !nonEmptyString(ref))) {
    problems.push("architecture_decision.admission_review.evidence_refs must be a non-empty string array");
  }
  if (!nonEmptyString(review.reason)) {
    problems.push("architecture_decision.admission_review.reason must be a non-empty string");
  }
  return problems;
}

function collectCanonicalTaskRefs() {
  const refs = new Map();
  for (const project of listProjectDirs()) {
    const filePath = path.join(milestonesDir, project, "tasks.json");
    try {
      const raw = readJson(filePath);
      for (const { task } of extractTasks(raw)) {
        if (nonEmptyString(task?.id)) refs.set(`${project}/${task.id}`, task);
      }
    } catch {
      // Invalid files are reported by the main validation pass.
    }
  }
  return refs;
}

function validateMorrowiseWeeklyCore(tasks, { asOf }) {
  const diagnostics = [];
  const weeklyCoreTasks = tasks.filter((task) => task?.weekly_core === true);

  if (weeklyCoreTasks.length > 1) {
    diagnostics.push({
      taskId: null,
      message: `at most one MorroWise task may have weekly_core=true; found ${weeklyCoreTasks.length}`,
    });
  }

  for (const task of tasks) {
    const taskId = nonEmptyString(task?.id) ? task.id : null;
    if (Object.hasOwn(task || {}, "weekly_core") && typeof task.weekly_core !== "boolean") {
      diagnostics.push({ taskId, message: "weekly_core must be a boolean when present" });
    }
    if (Object.hasOwn(task || {}, "review_date") && task.weekly_core !== true) {
      diagnostics.push({ taskId, message: "review_date is only allowed when weekly_core=true" });
    }
    if (task?.weekly_core !== true) continue;

    if (task.status !== "in_progress") {
      diagnostics.push({ taskId, message: "weekly_core=true requires status in_progress" });
    }
    if (!isDateOnly(task.review_date)) {
      diagnostics.push({ taskId, message: "weekly_core=true requires review_date in YYYY-MM-DD" });
    } else if (task.review_date <= asOf) {
      diagnostics.push({
        taskId,
        message: `weekly_core review_date has arrived; choose reframe, suspend, cancel, or complete (review_date=${task.review_date}, as_of=${asOf})`,
      });
    }
  }

  return diagnostics;
}

export function validateTasks({
  changedOnly = false,
  projects = new Set(),
  tracks = new Set(),
  asOf = todayInTaipei(),
} = {}) {
  const changedFiles = getChangedTaskFiles();
  const diagnostics = [];
  const canonicalTaskRefs = collectCanonicalTaskRefs();

  if (changedOnly) {
    for (const filePath of changedFiles) {
      if (fs.existsSync(filePath)) continue;
      const project = path.basename(path.dirname(filePath));
      if (projects.size > 0 && !projects.has(project)) continue;
      diagnostics.push({
        severity: "error",
        project,
        filePath,
        taskId: null,
        container: "tasks",
        message: "canonical tasks.json deletion is forbidden; restore the file and use cancel or archive lifecycle",
      });
    }
  }

  for (const project of listProjectDirs()) {
    if (projects.size > 0 && !projects.has(project)) continue;

    const filePath = path.join(milestonesDir, project, "tasks.json");
    if (changedOnly && !changedFiles.has(filePath) && project !== "morrowise") continue;

    let raw;
    try {
      raw = readJson(filePath);
    } catch (error) {
      diagnostics.push({
        severity: changedOnly && changedFiles.has(filePath) ? "error" : "warn",
        project,
        filePath,
        taskId: null,
        message: `tasks.json is not valid JSON: ${error.message}`,
      });
      continue;
    }

    const entries = extractTasks(raw);
    const relFile = path.relative(root, filePath);
    const previous = readHeadTasks(relFile);

    if (changedOnly && changedFiles.has(filePath)) {
      const currentTaskIds = new Set(entries.map(({ task }) => String(task?.id || "")).filter(Boolean));
      for (const previousTaskId of previous.keys()) {
        if (!currentTaskIds.has(previousTaskId)) {
          diagnostics.push({
            severity: "error",
            project,
            filePath,
            taskId: previousTaskId,
            container: "tasks",
            message: "canonical task deletion is forbidden; retain the task and use cancel or archive lifecycle",
          });
        }
      }
    }

    if (project === "morrowise") {
      for (const issue of validateMorrowiseWeeklyCore(entries.map((entry) => entry.task), { asOf })) {
        diagnostics.push({
          severity: "error",
          project,
          filePath,
          taskId: issue.taskId,
          container: "tasks",
          message: issue.message,
        });
      }
      if (changedOnly && !changedFiles.has(filePath)) continue;
    }

    for (const { task, container } of entries) {
      if (tracks.size > 0 && !tracks.has(String(task.track || ""))) continue;

      const taskId = String(task.id || "");
      const fingerprint = taskId ? JSON.stringify(task) : "";
      const previousTask = taskId ? previous.get(taskId) || null : null;
      const changed = changedFiles.has(filePath)
        && (!taskId || JSON.stringify(previousTask) !== fingerprint);
      const lifecycleMutation = requiresTaskLifecycleRoute({ task, changed, changedOnly });
      const severity = isCurrentWriteScope({ task, changed, changedOnly, project }) || lifecycleMutation ? "error" : "warn";

      for (const problem of validateTask(task, {
        project,
        changed,
        changedOnly,
        previousTask,
        canonicalTaskRefs,
      })) {
        diagnostics.push({
          severity,
          project,
          filePath,
          taskId: taskId || null,
          container,
          message: problem,
        });
      }
    }
  }

  return diagnostics;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return 0;
  }

  const diagnostics = validateTasks(args);
  const errors = diagnostics.filter((d) => d.severity === "error");
  const warnings = diagnostics.filter((d) => d.severity !== "error");

  for (const warning of warnings) {
    console.warn(formatDiagnostic("WARN", warning));
  }
  for (const error of errors) {
    console.error(formatDiagnostic("ERROR", error));
  }

  if (errors.length > 0) {
    console.error(`Task validation failed — ${errors.length} changed task issue(s), ${warnings.length} legacy warning(s)`);
    return 1;
  }

  console.log(`Task validation OK — ${diagnostics.length} issue(s), ${warnings.length} legacy warning(s)`);
  return 0;
}

function formatDiagnostic(level, diagnostic) {
  const rel = path.relative(root, diagnostic.filePath);
  const task = diagnostic.taskId ? ` task=${diagnostic.taskId}` : "";
  const container = diagnostic.container ? ` container=${diagnostic.container}` : "";
  return `${level} ${rel}${task}${container}: ${diagnostic.message}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
