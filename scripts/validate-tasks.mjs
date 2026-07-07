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
const ARCHITECTURE_GATE_TRACKS = new Set(["governance", "runtime-delivery", "auditor-mvp"]);

function parseArgs(argv) {
  const args = {
    changedOnly: false,
    projects: new Set(),
    tracks: new Set(),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--changed-only") {
      args.changedOnly = true;
    } else if (arg === "--project") {
      args.projects.add(argv[++i]);
    } else if (arg === "--track") {
      args.tracks.add(argv[++i]);
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
    "Usage: node scripts/validate-tasks.mjs [--changed-only] [--project <id>] [--track <id>]",
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
    return taskFingerprintMap(extractTasks(raw).map((entry) => entry.task));
  } catch {
    return new Map();
  }
}

function taskFingerprintMap(tasks) {
  const map = new Map();
  for (const task of tasks) {
    if (!task || typeof task !== "object" || !task.id) continue;
    map.set(String(task.id), JSON.stringify(task));
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

function validateTask(task, { project = "", changed = false, changedOnly = false } = {}) {
  const problems = [];
  const includeProjectScope = !changedOnly || changed;

  if (!task || typeof task !== "object" || Array.isArray(task)) {
    return ["task must be an object"];
  }

  if (!nonEmptyString(task.id)) problems.push("id must be a non-empty string");
  if (!nonEmptyString(task.title)) problems.push("title must be a non-empty string");
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

function requiresHcDecision(task, project = "", includeProjectScope = false) {
  return isPortableAgentScope(task, project, includeProjectScope) && ACTIVE_STATUSES.has(String(task.status || "todo").toLowerCase());
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

  return problems;
}

export function validateTasks({ changedOnly = false, projects = new Set(), tracks = new Set() } = {}) {
  const changedFiles = getChangedTaskFiles();
  const diagnostics = [];

  for (const project of listProjectDirs()) {
    if (projects.size > 0 && !projects.has(project)) continue;

    const filePath = path.join(milestonesDir, project, "tasks.json");
    if (changedOnly && !changedFiles.has(filePath)) continue;

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

    for (const { task, container } of entries) {
      if (tracks.size > 0 && !tracks.has(String(task.track || ""))) continue;

      const taskId = String(task.id || "");
      const fingerprint = taskId ? JSON.stringify(task) : "";
      const changed = changedFiles.has(filePath)
        && (!taskId || previous.get(taskId) !== fingerprint);
      const severity = isCurrentWriteScope({ task, changed, changedOnly, project }) ? "error" : "warn";

      for (const problem of validateTask(task, { project, changed, changedOnly })) {
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
