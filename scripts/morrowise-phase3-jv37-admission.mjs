#!/usr/bin/env node
// This executable owns only the JV-37 receipt seam, not full P3 admission.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { evaluateJv37Admission } from "./lib/jv37-admission.mjs";
import { refreshCanonicalMain, validatePilotReceipt } from "./lib/repo-coordination-runtime.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const canonicalRemoteUrlHash = crypto.createHash("sha256").update("https://github.com/hisenzi/harness-mc.git").digest("hex");
const options = parseArgs(process.argv.slice(2));
const receipt = readJson(options.receiptPath);
if (!Array.isArray(receipt?.required_ids) || !Array.isArray(receipt?.results)) {
  console.log(JSON.stringify({ decision: "blocked", reason: "matrix_results_incomplete" }, null, 2));
  process.exit(2);
}
const originUrl = spawnSync("git", ["remote", "get-url", "origin"], { cwd: repoRoot, encoding: "utf8" });
if (originUrl.status !== 0
  || crypto.createHash("sha256").update(originUrl.stdout.trim().replace(/\/$/, "")).digest("hex") !== canonicalRemoteUrlHash) {
  throw new Error("canonical origin mismatch");
}
const refreshed = refreshCanonicalMain({
  repoPath: repoRoot,
  remote: "origin",
  expectedRemoteUrlHash: canonicalRemoteUrlHash,
});
if (refreshed.decision !== "READY") {
  console.log(JSON.stringify({ decision: "blocked", reason: refreshed.reason, ...(refreshed.details ? { details: refreshed.details } : {}) }, null, 2));
  process.exit(2);
}
const taskData = readJsonAtRef("origin/main", "milestones/morrowise/tasks.json");
const stateData = readJsonAtRef("origin/main", "milestones/morrowise/state.json") || { tasks: {} };
const definition = taskData.tasks?.find((task) => task.id === "multi-machine-repo-coordination-gate");
if (!definition) throw new Error("multi-machine-repo-coordination-gate task missing");
const jv37Task = { ...definition, ...(stateData.tasks?.[definition.id] || {}) };
const currentFingerprint = `sha256:${crypto.createHash("sha256").update(JSON.stringify(definition.acceptance_matrix)).digest("hex")}`;
const pilotVerification = validatePilotReceipt(receipt, {
  repoPath: repoRoot,
  root: repoRoot,
  remote: "origin",
  tasksPath: options.tasksPath,
  canonicalTasks: taskData,
  expectedRemoteUrlHash: canonicalRemoteUrlHash,
});
const result = evaluateJv37Admission({ jv37Task, receipt, currentFingerprint, pilotVerification });
console.log(JSON.stringify(result, null, 2));
if (result.decision !== "accepted") process.exitCode = 2;

function parseArgs(argv) {
  const options = {
    tasksPath: path.join(repoRoot, "milestones", "morrowise", "tasks.json"),
    statePath: path.join(repoRoot, "milestones", "morrowise", "state.json"),
    receiptPath: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--receipt") options.receiptPath = path.resolve(argv[++index] || "");
    else throw new Error(`unknown argument: ${argv[index]}`);
  }
  if (!options.receiptPath) throw new Error("--receipt <source-bound JSON> is required");
  return options;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readJsonAtRef(ref, relativePath) {
  const result = spawnSync("git", ["show", `${ref}:${relativePath}`], { cwd: repoRoot, encoding: "utf8" });
  if (result.status !== 0) return null;
  return JSON.parse(result.stdout);
}
