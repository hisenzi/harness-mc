#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const morrowiseTasks = JSON.parse(fs.readFileSync(path.join(repoRoot, "milestones", "morrowise", "tasks.json"), "utf8"));
const jv37 = morrowiseTasks.tasks.find((task) => task.id === "multi-machine-repo-coordination-gate");
for (const acceptanceId of ["A18｜", "A19｜"]) {
  assert.ok(jv37?.acceptance?.some((entry) => entry.startsWith(acceptanceId)), `JV-37 is missing ${acceptanceId}`);
}

withFixture(({ collabRoot, registryPath, initScript, commandLog, env }) => {
  const id = "standalone-without-receipt";
  const result = runInit({ initScript, id, registryPath, env });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const milestoneDir = path.join(collabRoot, "harness-mc", "milestones", id);
  assert.deepEqual(fs.readdirSync(milestoneDir).sort(), ["project.json", "tasks.json"]);
  const project = readJson(path.join(milestoneDir, "project.json"));
  assert.equal(project.repo_ref, null);
  assert.deepEqual(project.repo_creation, { create_repo: false, approval_ref: null });
  assert.equal(fs.existsSync(path.join(collabRoot, id)), false, "standalone type alone must not create a repo directory");
  assert.equal(readLog(commandLog), "", "standalone type alone must not invoke gh or git");
});

withFixture(({ collabRoot, registryPath, initScript, commandLog, env }) => {
  const id = "existing-repo";
  const result = runInit({ initScript, id, registryPath, existingRepoRef: `hisenzi/${id}`, env });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const project = readJson(path.join(collabRoot, "harness-mc", "milestones", id, "project.json"));
  assert.equal(project.repo_ref, `hisenzi/${id}`);
  assert.deepEqual(project.repo_creation, { create_repo: false, approval_ref: null });
  assert.equal(readLog(commandLog), "", "attaching an existing repo must not invoke gh or git");
});

withFixture(({ collabRoot, registryPath, initScript, commandLog, env }) => {
  const id = "existing-repo-mismatch";
  const before = digestTree(collabRoot);
  const result = runInit({ initScript, id, registryPath, existingRepoRef: "hisenzi/another-project", env });
  assert.equal(result.status, 2, result.stderr || result.stdout);
  assert.equal(readLog(commandLog), "", "a mismatched existing repo must not invoke gh or git");
  assert.equal(digestTree(collabRoot), before, "a mismatched existing repo changed the fixture");
});

withFixture(({ collabRoot, registryPath, initScript, commandLog, env }) => {
  const id = "kj-mascot";
  const result = runInit({ initScript, id, registryPath, env, group: "kj", folderDate: "260803" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const groupedDir = path.join(collabRoot, "harness-mc", "milestones", "kj", "260803-kj-mascot");
  assert.deepEqual(fs.readdirSync(groupedDir).sort(), ["project.json", "tasks.json"]);
  assert.equal(fs.existsSync(path.join(collabRoot, "harness-mc", "milestones", id)), false);
  const project = readJson(path.join(groupedDir, "project.json"));
  assert.equal(project.milestone.project_id, id);
  assert.equal(project.milestone.relative_ref, "milestones/kj/260803-kj-mascot");
  assert.equal(readLog(commandLog), "", "grouped internal milestone must not invoke gh or git");
});

withFixture(({ collabRoot, registryPath, records, initScript, env }) => {
  fs.mkdirSync(path.join(collabRoot, "needs-review"));
  records.push(record("needs-review", { classification: "unknown", migration_state: "not_assessed", project_home_ref: null, topology_profile: null, repo_ref: null }));
  writeRegistry(registryPath, records);
  const result = runInit({ initScript, id: "attention-does-not-block", registryPath, env });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.existsSync(path.join(collabRoot, "harness-mc", "milestones", "attention-does-not-block", "project.json")), true);
});

withFixture(({ collabRoot, registryPath, initScript, commandLog, env }) => {
  fs.mkdirSync(path.join(collabRoot, "surprise"));
  const result = runInit({ initScript, id: "global-degraded-does-not-block", registryPath, env });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.existsSync(path.join(collabRoot, "harness-mc", "milestones", "global-degraded-does-not-block", "project.json")), true);
  assert.equal(readLog(commandLog), "");
});

for (const receiptCase of ["wrong-project", "ambiguous"]) {
  withFixture(({ collabRoot, fixtureParent, registryPath, initScript, commandLog, env }) => {
    const id = `receipt-${receiptCase}`;
    const receiptPath = path.join(fixtureParent, `${receiptCase}.json`);
    writeReceipt(receiptPath, {
      receipt_id: `vincent-${receiptCase}`,
      schema_version: "morrowise.repo-create-approval.v1",
      action: "create_repo",
      project_id: receiptCase === "wrong-project" ? "another-project" : `${id}-or-another-project`,
      approved_by: "Vincent",
      decision: "approved",
    });
    const before = digestTree(collabRoot);
    const result = runInit({ initScript, id, registryPath, receiptPath, env });
    assert.equal(result.status, 2, result.stderr || result.stdout);
    assert.equal(readLog(commandLog), "", `${receiptCase} receipt invoked a command`);
    assert.equal(digestTree(collabRoot), before, `${receiptCase} receipt changed the fixture`);
  });
}

withFixture(({ collabRoot, fixtureParent, registryPath, initScript, commandLog, env }) => {
  const id = "receipt-valid";
  const receiptPath = path.join(fixtureParent, "valid.json");
  writeReceipt(receiptPath, {
    receipt_id: "vincent-receipt-valid",
    schema_version: "morrowise.repo-create-approval.v1",
    action: "create_repo",
    project_id: id,
    approved_by: "Vincent",
    decision: "approved",
  });
  const result = runInit({ initScript, id, registryPath, receiptPath, env });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const project = readJson(path.join(collabRoot, "harness-mc", "milestones", id, "project.json"));
  assert.deepEqual(project.repo_creation, { create_repo: true, approval_ref: "vincent-receipt-valid" });
  assert.equal(project.repo_ref, `hisenzi/${id}`);
  const log = readLog(commandLog);
  assert.match(log, new RegExp(`^gh repo create hisenzi/${id} --private --clone$`, "m"));
  assert.equal((log.match(/^gh /gm) || []).length, 1, log);
  assert.ok((log.match(/^git /gm) || []).length > 0, "valid receipt must reach fake git after fake gh");
});

console.log("project-init topology admission and repo receipt verification OK — JV43-A11=pass JV43-A13=pass JV37-A18=pass JV37-A19=pass");

function withFixture(callback) {
  const fixtureParent = fs.mkdtempSync(path.join(os.tmpdir(), "project-init-admission-"));
  const collabRoot = path.join(fixtureParent, "collab");
  const mcRoot = path.join(collabRoot, "harness-mc");
  const notyetRoot = path.join(collabRoot, "notyet-harness");
  const scriptsRoot = path.join(mcRoot, "scripts");
  fs.mkdirSync(path.join(scriptsRoot, "lib"), { recursive: true });
  fs.mkdirSync(path.join(mcRoot, "milestones"), { recursive: true });
  fs.mkdirSync(path.join(mcRoot, "system-workflow", "registries"), { recursive: true });
  fs.mkdirSync(path.join(notyetRoot, "000_Agent", "config"), { recursive: true });
  copy("scripts/new-project.py", path.join(scriptsRoot, "new-project.py"));
  copy("scripts/milestone-project-index.mjs", path.join(scriptsRoot, "milestone-project-index.mjs"));
  copy("scripts/lib/milestone-projects.mjs", path.join(scriptsRoot, "lib", "milestone-projects.mjs"));
  copy("scripts/project-write-admission.mjs", path.join(scriptsRoot, "project-write-admission.mjs"));
  copy("scripts/project-topology-health.mjs", path.join(scriptsRoot, "project-topology-health.mjs"));
  copy("scripts/lib/collab-root.mjs", path.join(scriptsRoot, "lib", "collab-root.mjs"));
  fs.writeFileSync(path.join(notyetRoot, "000_Agent", "config", "repos.json"), "{\"repos\":[]}\n");
  fs.writeFileSync(path.join(notyetRoot, "000_Agent", "ARCHITECTURE.md"), "| hisenzi/how-i-work | marker | marker |\n");
  fs.mkdirSync(path.join(mcRoot, "milestones", "kj"), { recursive: true });
  fs.writeFileSync(path.join(mcRoot, "milestones", "kj", "group.json"), `${JSON.stringify({
    schema_version: "morrowise.milestone-group.v1",
    id: "kj",
    name: "KJ",
    layout: "grouped-yymmdd-project-v1",
    max_project_depth: 1,
  })}\n`);

  const registryPath = path.join(mcRoot, "system-workflow", "registries", "morrowise-project-topology.json");
  const records = [record("harness-mc", { topology_profile: "morrowise-control-plane" }), record("notyet-harness", { topology_profile: "agent-control-plane" })];
  writeRegistry(registryPath, records);

  const fakeBin = path.join(fixtureParent, "fake-bin");
  const commandLog = path.join(fixtureParent, "commands.log");
  fs.mkdirSync(fakeBin);
  fs.writeFileSync(commandLog, "");
  writeExecutable(path.join(fakeBin, "gh"), "#!/bin/sh\nprintf 'gh %s\\n' \"$*\" >> \"$COMMAND_LOG\"\nrepo=\"$3\"\nid=${repo#*/}\nmkdir -p \"$PWD/$id\"\n");
  writeExecutable(path.join(fakeBin, "git"), "#!/bin/sh\nprintf 'git %s\\n' \"$*\" >> \"$COMMAND_LOG\"\n");
  const env = { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`, COMMAND_LOG: commandLog };
  try {
    callback({ fixtureParent, collabRoot, mcRoot, registryPath, records, initScript: path.join(scriptsRoot, "new-project.py"), commandLog, env });
  } finally {
    fs.rmSync(fixtureParent, { recursive: true, force: true });
  }
}

function runInit({ initScript, id, registryPath, receiptPath, existingRepoRef, env, group = null, folderDate = null }) {
  const args = [
    initScript,
    "--id", id,
    "--name", `驗證 ${id}`,
    "--desc", "驗證 project-init topology 與 repo receipt 接線。",
    "--type", "standalone",
    "--problem", "milestone 與 repo 被錯誤視為同一件事。",
    "--impact", "避免未授權 repo 建立與非法目的地寫入。",
    "--metric", "通過 fixtures 比例",
    "--baseline", "0%",
    "--target", "100%",
    "--due", "2026-08-31",
    "--measurement-source", "npm run test:project-init-admission",
    "--no-sync",
    "--topology-registry", registryPath,
  ];
  if (group) args.push("--group", group);
  if (folderDate) args.push("--folder-date", folderDate);
  if (receiptPath) args.push("--repo-create-receipt", receiptPath);
  if (existingRepoRef) args.push("--existing-repo-ref", existingRepoRef);
  return spawnSync("python3", args, { cwd: path.dirname(path.dirname(initScript)), encoding: "utf8", env });
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
    last_verified_at: "2026-08-02",
    notes: "fixture",
    ...overrides,
  };
}

function writeRegistry(registryPath, records) {
  fs.writeFileSync(registryPath, `${JSON.stringify({
    registry_id: "morrowise-project-topology.v1",
    maintenance_policy: { startup_command: "npm run health:project-topology", evidence_warn_after_days: 30, startup_rule: "target integrity findings reject only that target; global maintenance findings remain visible as degraded and do not block a safe scoped target" },
    records,
  })}\n`);
}

function writeReceipt(receiptPath, receipt) {
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt)}\n`);
}

function copy(relative, destination) {
  fs.copyFileSync(path.join(repoRoot, relative), destination);
}

function writeExecutable(destination, contents) {
  fs.writeFileSync(destination, contents, { mode: 0o755 });
}

function readJson(destination) {
  return JSON.parse(fs.readFileSync(destination, "utf8"));
}

function readLog(destination) {
  return fs.readFileSync(destination, "utf8").trim();
}

function digestTree(root) {
  const hash = crypto.createHash("sha256");
  walk(root, hash, root);
  return hash.digest("hex");
}

function walk(current, hash, root) {
  for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = path.join(current, entry.name);
    hash.update(`${entry.isDirectory() ? "d" : "f"}:${path.relative(root, absolute)}\0`);
    if (entry.isDirectory()) walk(absolute, hash, root);
    else if (entry.isFile()) hash.update(fs.readFileSync(absolute));
  }
}
