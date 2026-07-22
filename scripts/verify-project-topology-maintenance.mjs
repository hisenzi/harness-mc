import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCollabRoot } from "./lib/collab-root.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const collabRoot = resolveCollabRoot(repoRoot);
const healthScript = path.join(repoRoot, "scripts", "project-topology-health.mjs");
const rootAgentGuide = path.join(collabRoot, "AGENTS.md");
const pairedNotyetRoot = path.join(collabRoot, "notyet-harness", ".worktrees", path.basename(repoRoot));
const notyetRoot = process.env.NOTYET_HARNESS_ROOT
  ? path.resolve(process.env.NOTYET_HARNESS_ROOT)
  : fs.existsSync(pairedNotyetRoot)
    ? pairedNotyetRoot
    : path.join(collabRoot, "notyet-harness");
const architectureDoc = path.join(notyetRoot, "000_Agent", "ARCHITECTURE.md");
const notyetAgentGuide = path.join(notyetRoot, "AGENTS.md");
const coreGuide = path.join(notyetRoot, "000_Agent", "CORE.md");

assert.ok(fs.existsSync(healthScript), "missing project topology maintenance health script");

const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
assert.equal(packageJson.scripts["health:project-topology"], "node scripts/project-topology-health.mjs --summary");
assert.equal(packageJson.scripts["test:project-topology-maintenance"], "node scripts/verify-project-topology-maintenance.mjs");

const agentGuide = fs.readFileSync(rootAgentGuide, "utf8");
assert.match(agentGuide, /npm run health:project-topology/, "startup guide must require the topology health check");
assert.match(agentGuide, /Maintenance Inbox/, "startup guide must route agents to the Maintenance Inbox");
assert.match(fs.readFileSync(notyetAgentGuide, "utf8"), /Project Topology Startup Gate/, "notyet-harness entry must route direct sessions to the root topology gate");
const coreRules = fs.readFileSync(coreGuide, "utf8");
assert.match(coreRules, /Project Topology Operation Gate/, "versioned CORE rules must contain the portable topology gate");
assert.match(coreRules, /npm run health:project-topology/, "versioned CORE rules must require the canonical topology health command");

const architecture = fs.readFileSync(architectureDoc, "utf8");
assert.match(architecture, /<!-- project-topology-maintenance:start -->/, "ARCHITECTURE.md must contain the generated Maintenance Inbox");
assert.match(architecture, /npm run health:project-topology/, "Maintenance Inbox must expose the health command");
assert.doesNotMatch(architecture, /\(\d+d\/\d+d\)/, "Maintenance Inbox must not serialize dynamic elapsed-day output");

withFixture((fixtureRoot) => {
  makeDirectory(fixtureRoot, "known-project");
  makeDirectory(fixtureRoot, "surprise");
  const result = runHealth(fixtureRoot, [record("known-project")]);
  assert.equal(result.process_status, 1, "an unregistered root directory must block startup");
  assertItem(result, "unregistered_topology_root", "error", "$COLLAB/surprise");
});

withFixture((fixtureRoot) => {
  makeDirectory(fixtureRoot, "needs-classification");
  const result = runHealth(fixtureRoot, [record("needs-classification", { classification: "unknown", migration_state: "not_assessed" })]);
  assert.equal(result.process_status, 0, "a recorded unknown directory is actionable, not an integrity blocker");
  assertItem(result, "unclassified_topology_record", "action", "$COLLAB/needs-classification");
});

withFixture((fixtureRoot) => {
  makeDirectory(fixtureRoot, "legacy-worktree");
  const result = runHealth(fixtureRoot, [record("legacy-worktree", { classification: "git_worktree", migration_state: "blocked" })]);
  assert.equal(result.process_status, 0, "a known blocked worktree must remain visible without blocking unrelated startup");
  assertItem(result, "blocked_worktree_migration", "action", "$COLLAB/legacy-worktree");
});

withFixture((fixtureRoot) => {
  makeDirectory(fixtureRoot, "stale-project");
  const result = runHealth(fixtureRoot, [record("stale-project", { last_verified_at: "2000-01-01" })]);
  assert.equal(result.process_status, 1, "stale topology evidence must block startup");
  assertItem(result, "stale_topology_evidence", "error", "$COLLAB/stale-project");
});

console.log("Project Topology Maintenance verification OK");

function withFixture(callback) {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "project-topology-maintenance-"));
  try {
    callback(fixtureRoot);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

function makeDirectory(root, name) {
  fs.mkdirSync(path.join(root, name), { recursive: true });
}

function record(name, overrides = {}) {
  return {
    id: name,
    path_label: `$COLLAB/${name}`,
    classification: "canonical_project",
    migration_state: "inventory_only",
    project_home_ref: `$COLLAB/${name}`,
    topology_profile: "git-repository",
    document_ref: null,
    repo_ref: `$COLLAB/${name}`,
    evidence: [`$COLLAB/${name}`],
    last_verified_at: "2026-07-20",
    notes: "fixture",
    ...overrides,
  };
}

function runHealth(fixtureRoot, records) {
  const registryPath = path.join(fixtureRoot, "topology.json");
  fs.writeFileSync(registryPath, `${JSON.stringify({
    registry_id: "morrowise-project-topology.v1",
    maintenance_policy: {
      evidence_warn_after_days: 30,
      startup_command: "npm run health:project-topology",
    },
    records,
  })}\n`);
  const execution = spawnSync(process.execPath, [healthScript, "--collab-root", fixtureRoot, "--registry", registryPath, "--format", "json"], {
    encoding: "utf8",
  });
  assert.equal(execution.signal, null, execution.stderr);
  assert.notEqual(execution.status, null, execution.stderr);
  return { process_status: execution.status, ...JSON.parse(execution.stdout) };
}

function assertItem(result, code, severity, ref) {
  assert.ok(
    result.items.some((item) => item.code === code && item.severity === severity && item.ref === ref),
    `expected ${severity} ${code} for ${ref}; got ${JSON.stringify(result.items)}`,
  );
}
