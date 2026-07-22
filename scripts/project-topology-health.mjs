#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCollabRoot } from "./lib/collab-root.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const args = parseArgs(process.argv.slice(2));
const collabRoot = path.resolve(args.collabRoot || resolveCollabRoot(repoRoot));
const registryPath = path.resolve(args.registry || path.join(repoRoot, "system-workflow", "registries", "morrowise-project-topology.json"));

try {
  const report = inspectTopology({ collabRoot, registryPath, strict: args.strict });
  if (args.format === "json") {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(formatSummary(report));
  }
  process.exitCode = report.exit_code;
} catch (error) {
  process.stderr.write(`ERROR: ${error.message}\n`);
  process.exitCode = 1;
}

function parseArgs(values) {
  const parsed = { format: "summary", strict: false };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--summary") {
      parsed.format = "summary";
    } else if (value === "--format") {
      parsed.format = values[++index];
    } else if (value === "--collab-root") {
      parsed.collabRoot = values[++index];
    } else if (value === "--registry") {
      parsed.registry = values[++index];
    } else if (value === "--strict") {
      parsed.strict = true;
    } else {
      throw new Error(`unsupported argument: ${value}`);
    }
  }
  if (!["summary", "json"].includes(parsed.format)) throw new Error(`unsupported format: ${parsed.format}`);
  return parsed;
}

function inspectTopology({ collabRoot, registryPath, strict }) {
  if (!fs.existsSync(collabRoot)) throw new Error(`$COLLAB root missing: ${collabRoot}`);
  if (!fs.existsSync(registryPath)) throw new Error(`topology registry missing: ${registryPath}`);
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  if (registry.registry_id !== "morrowise-project-topology.v1") throw new Error("invalid project topology registry id");
  const policy = registry.maintenance_policy || {};
  const maxEvidenceAge = policy.evidence_warn_after_days ?? 30;
  if (!Number.isInteger(maxEvidenceAge) || maxEvidenceAge < 1) throw new Error("maintenance_policy.evidence_warn_after_days must be a positive integer");
  const records = Array.isArray(registry.records) ? registry.records : [];
  const recordsByRef = new Map();
  const items = [];

  for (const record of records) {
    if (!isRootRef(record.path_label)) continue;
    if (recordsByRef.has(record.path_label)) {
      items.push(item("duplicate_topology_root", "error", record.path_label, "JV-43 Project Topology Registry", "Remove the duplicate registry record before modifying project folders."));
      continue;
    }
    recordsByRef.set(record.path_label, record);
    const localPath = fromCollabRef(collabRoot, record.path_label);
    if (!fs.existsSync(localPath)) {
      items.push(item("missing_registered_topology_root", "error", record.path_label, "JV-43 Project Topology Registry", "Restore the registered directory or update its approved migration record."));
    }
    if (daysOld(record.last_verified_at) > maxEvidenceAge) {
      items.push(item("stale_topology_evidence", "error", record.path_label, "JV-43 Project Topology Registry", `Refresh inventory evidence; it exceeds the ${maxEvidenceAge}d policy.`));
    }
    if (record.classification === "unknown") {
      items.push(item("unclassified_topology_record", "action", record.path_label, "JV-43 Project Topology Registry", "Classify, archive, exempt, or create an approved migration record; do not infer a project home."));
    }
    if (record.migration_state === "blocked") {
      const code = record.classification === "git_worktree" ? "blocked_worktree_migration" : "blocked_topology_migration";
      const owner = record.classification === "git_worktree" ? "JV-37 Repo Coordination Contract" : "JV-43 Project Topology Registry";
      const nextAction = record.classification === "git_worktree"
        ? "Run Git preflight; use git worktree move or safe closeout only after an approved migration record."
        : "Review the blocking record and add an approved, reversible migration path.";
      items.push(item(code, "action", record.path_label, owner, nextAction));
    }
  }

  const liveRootRefs = fs.readdirSync(collabRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `$COLLAB/${entry.name}`)
    .sort();
  for (const ref of liveRootRefs) {
    if (!recordsByRef.has(ref)) {
      items.push(item("unregistered_topology_root", "error", ref, "JV-43 Project Topology Registry", "Add a read-only inventory record before creating, moving, or treating this folder as a project."));
    }
  }

  const sortedItems = items.sort(compareItems);
  const errorCount = sortedItems.filter((entry) => entry.severity === "error").length;
  const actionCount = sortedItems.filter((entry) => entry.severity === "action").length;
  const exitCode = errorCount > 0 || (strict && actionCount > 0) ? 1 : 0;
  return {
    status: errorCount > 0 ? "blocked" : actionCount > 0 ? "attention" : "ready",
    exit_code: exitCode,
    source_of_truth: "$COLLAB/harness-mc/system-workflow/registries/morrowise-project-topology.json",
    command: "npm run health:project-topology",
    summary: { errors: errorCount, actions: actionCount, total: sortedItems.length },
    items: sortedItems,
  };
}

function isRootRef(ref) {
  return typeof ref === "string" && /^\$COLLAB\/[^/]+$/.test(ref);
}

function fromCollabRef(collabRoot, ref) {
  return path.join(collabRoot, ref.slice("$COLLAB/".length));
}

function daysOld(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return Number.POSITIVE_INFINITY;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed)) return Number.POSITIVE_INFINITY;
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((today - parsed) / 86_400_000);
}

function item(code, severity, ref, owner, next_action) {
  return { code, severity, ref, owner, next_action };
}

function compareItems(left, right) {
  const severityRank = { error: 0, action: 1 };
  return severityRank[left.severity] - severityRank[right.severity]
    || left.code.localeCompare(right.code)
    || left.ref.localeCompare(right.ref);
}

function formatSummary(report) {
  const lines = [
    "Project Topology Maintenance Inbox",
    `status: ${report.status} | errors: ${report.summary.errors} | actions: ${report.summary.actions}`,
    `source: ${report.source_of_truth}`,
    `command: ${report.command}`,
  ];
  if (report.items.length === 0) {
    lines.push("No topology maintenance actions.");
  } else {
    for (const group of summarizeItems(report.items)) {
      lines.push(`[${group.severity.toUpperCase()}] ${group.code} × ${group.count}`);
      lines.push(`  owner: ${group.owner}`);
      lines.push(`  next: ${group.next_action}`);
      lines.push(`  refs: ${group.refs.join(", ")}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function summarizeItems(items) {
  const groups = new Map();
  for (const entry of items) {
    const key = [entry.severity, entry.code, entry.owner, entry.next_action].join("\u0000");
    const group = groups.get(key) || { ...entry, count: 0, refs: [] };
    group.count += 1;
    group.refs.push(entry.ref);
    groups.set(key, group);
  }
  return [...groups.values()];
}
