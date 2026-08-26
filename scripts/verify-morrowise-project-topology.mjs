import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCollabRoot } from "./lib/collab-root.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const collabRoot = resolveCollabRoot(repoRoot);
const registryPath = path.join(repoRoot, "system-workflow", "registries", "morrowise-project-topology.json");
const schemaPath = path.join(repoRoot, "system-workflow", "schemas", "morrowise-project-topology.schema.json");
const healthScript = path.join(repoRoot, "scripts", "project-topology-health.mjs");

assert.ok(fs.existsSync(registryPath), "Project Topology Registry must exist");
assert.ok(fs.existsSync(schemaPath), "Project Topology schema must exist");

const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));

assert.equal(registry.registry_id, "morrowise-project-topology.v1");
assert.equal(registry.task_id, "project-topology-architecture-atlas");
assert.equal(registry.source_of_truth, "$COLLAB/harness-mc/system-workflow/registries/morrowise-project-topology.json");
assert.equal(registry.schema_ref, "$COLLAB/harness-mc/system-workflow/schemas/morrowise-project-topology.schema.json");
assert.equal(registry.verifier_ref, "npm run test:project-topology");
assert.ok(registry.maintenance_policy, "topology registry must define maintenance_policy");
const maintenancePolicy = registry.maintenance_policy;
assert.equal(maintenancePolicy.startup_command, "npm run health:project-topology");
assert.equal(maintenancePolicy.evidence_warn_after_days, 30);
assert.match(maintenancePolicy.startup_rule, /target.*global.*degraded/i, "maintenance policy must distinguish target rejection from global maintenance");
assert.equal(schema.$id, "https://hisenzi.local/schemas/morrowise-project-topology.schema.json");

const classifications = new Set(["canonical_project", "git_worktree", "generated", "runtime", "archive", "unknown"]);
const migrationStates = new Set(["not_assessed", "inventory_only", "blocked", "exempt", "planned", "approved", "migrated", "verified"]);
const requiredFields = ["id", "path_label", "classification", "migration_state", "project_home_ref", "topology_profile", "evidence", "last_verified_at", "notes"];

assert.deepEqual(registry.classification_vocabulary, [...classifications]);
assert.deepEqual(registry.migration_state_vocabulary, [...migrationStates]);
assert.match(registry.updated_at, /^\d{4}-\d{2}-\d{2}$/, "registry updated_at must be YYYY-MM-DD");
assert.match(registry.inventory_as_of, /^\d{4}-\d{2}-\d{2}$/, "registry inventory_as_of must be YYYY-MM-DD");
assert.match(registry.document_registry_ref, /#document-source-registry-and-human-sync$/, "JV-36 must remain a thin task reference");
assert.match(registry.repo_coordination_ref, /#multi-machine-repo-coordination-gate$/, "JV-37 must remain a thin task reference");
assert.match(registry.write_boundary.forbidden.join(" "), /second source of truth/i, "registry must forbid duplicate JV-36/JV-37 state");

assert.ok(Array.isArray(registry.records) && registry.records.length > 0, "registry records are required");
assert.ok(Array.isArray(registry.profiles) && registry.profiles.length > 0, "topology profiles are required");
const profileIds = new Set();
for (const profile of registry.profiles) {
  assert.match(profile.id, /^[a-z0-9][a-z0-9-]*$/, `profile id must be kebab-case: ${profile.id}`);
  assert.equal(profileIds.has(profile.id), false, `duplicate topology profile: ${profile.id}`);
  assert.equal(typeof profile.applies_to, "string", `${profile.id} applies_to must be text`);
  assert.ok(Array.isArray(profile.baseline) && profile.baseline.length > 0, `${profile.id} needs a baseline`);
  assert.equal(typeof profile.extension_policy, "string", `${profile.id} extension policy must be text`);
  assert.equal(typeof profile.local_artifact_policy, "string", `${profile.id} local artifact policy must be text`);
  profileIds.add(profile.id);
}
const recordsByPath = new Map();
for (const record of registry.records) {
  for (const field of requiredFields) assert.ok(Object.hasOwn(record, field), `record ${record.id || "(missing id)"} missing ${field}`);
  assert.match(record.id, /^[a-z0-9][a-z0-9-]*$/, `record id must be kebab-case: ${record.id}`);
  assert.match(record.path_label, /^\$COLLAB\//, `record path must be $COLLAB-relative: ${record.id}`);
  assert.equal(/\/Users\//.test(JSON.stringify(record)), false, `record must not contain local absolute paths: ${record.id}`);
  assert.ok(classifications.has(record.classification), `invalid classification: ${record.id}`);
  assert.ok(migrationStates.has(record.migration_state), `invalid migration state: ${record.id}`);
  if (record.topology_profile) assert.ok(profileIds.has(record.topology_profile), `record references unknown topology profile: ${record.id}`);
  assert.match(record.last_verified_at, /^\d{4}-\d{2}-\d{2}$/, `invalid verification date: ${record.id}`);
  assert.ok(Array.isArray(record.evidence) && record.evidence.length > 0, `record evidence is required: ${record.id}`);
  for (const ref of [record.project_home_ref, record.document_ref, record.repo_ref, ...record.evidence]) {
    if (ref === null) continue;
    assert.match(ref, /^\$COLLAB\//, `record ref must remain $COLLAB-relative: ${record.id}`);
  }
  if (record.classification === "canonical_project") {
    assert.equal(record.project_home_ref, record.path_label, `canonical project home must equal its registered root: ${record.id}`);
  }
  assert.equal(recordsByPath.has(record.path_label), false, `duplicate root path: ${record.path_label}`);
  recordsByPath.set(record.path_label, record);
}

const topLevelDirs = fs.readdirSync(collabRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const registeredDirs = [...recordsByPath.keys()].map((label) => label.replace(/^\$COLLAB\//, "")).sort();
const health = spawnSync(process.execPath, [healthScript, "--collab-root", collabRoot, "--registry", registryPath, "--format", "json"], { encoding: "utf8" });
assert.equal(health.signal, null, health.stderr);
const healthReport = JSON.parse(health.stdout);
assert.ok(["ready", "degraded"].includes(healthReport.global_status), "health must report global readiness separately");

for (const name of topLevelDirs) {
  const target = path.join(collabRoot, name, ".git");
  const record = recordsByPath.get(`$COLLAB/${name}`);
  if (!record) {
    assert.ok(
      healthReport.items.some((item) => item.code === "unregistered_topology_root" && item.ref === `$COLLAB/${name}`),
      `unregistered root must remain a visible maintenance finding: ${name}`,
    );
    continue;
  }
  if (!fs.existsSync(target)) continue;
  const gitStat = fs.lstatSync(target);
  if (gitStat.isDirectory()) {
    assert.equal(record.classification, "canonical_project", `${name} is a canonical Git project`);
  } else if (gitStat.isFile()) {
    assert.equal(record.classification, "git_worktree", `${name} is a Git worktree`);
    assert.match(record.project_home_ref, /^\$COLLAB\//, `${name} must reference its canonical project home`);
  }
}

for (const name of registeredDirs) {
  const localPath = path.join(collabRoot, name);
  if (fs.existsSync(localPath)) continue;
  assert.ok(
    healthReport.items.some((item) => item.code === "missing_registered_topology_root" && item.ref === `$COLLAB/${name}`),
    `missing registered root must remain a visible maintenance finding: ${name}`,
  );
}

console.log(`Project Topology Registry verification OK — ${registry.records.length} root records`);
