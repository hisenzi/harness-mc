#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCollabRoot } from "./lib/collab-root.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const healthScript = path.join(__dirname, "project-topology-health.mjs");

export function admitProjectWrite({ destination, cwd = process.cwd(), collabRoot = resolveCollabRoot(repoRoot), registryPath = path.join(repoRoot, "system-workflow", "registries", "morrowise-project-topology.json") }) {
  const absoluteCollab = path.resolve(collabRoot);
  const absoluteDestination = path.resolve(cwd, destination);
  if (!isWithin(absoluteCollab, absoluteDestination) || absoluteDestination === absoluteCollab) {
    return blocked("destination_outside_collab", absoluteDestination, null, "destination must stay inside a registered canonical project home");
  }

  const topology = runTopologyHealth({ collabRoot: absoluteCollab, registryPath });
  if (topology.error) {
    return blocked("topology_check_failed", absoluteDestination, null, topology.error);
  }

  let registry;
  try {
    registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  } catch (error) {
    return blocked("topology_check_failed", absoluteDestination, topology.report.status, error.message);
  }

  const relative = path.relative(absoluteCollab, absoluteDestination);
  const rootName = relative.split(path.sep)[0];
  const targetRef = `$COLLAB/${rootName}`;
  const targetIntegrityFinding = topology.report.items.find((item) => (
    item.ref === targetRef
    && item.severity === "error"
    && item.code !== "stale_topology_evidence"
  ));
  if (targetIntegrityFinding) {
    return blocked("target_topology_blocked", absoluteDestination, topology.report.status, `target integrity finding: ${targetIntegrityFinding.code}`);
  }
  const records = Array.isArray(registry.records) ? registry.records : [];
  const record = records.find((entry) => entry.path_label === targetRef);
  if (!record) {
    return blocked("target_unregistered", absoluteDestination, topology.report.status, `${targetRef} has no topology record`);
  }
  if (record.classification !== "canonical_project" || record.project_home_ref !== record.path_label) {
    return blocked("target_not_canonical", absoluteDestination, topology.report.status, `${targetRef} is ${record.classification || "unknown"}, not a canonical project home`);
  }
  if (record.migration_state === "blocked") {
    return blocked("target_migration_blocked", absoluteDestination, topology.report.status, `${targetRef} has a blocked migration state`);
  }

  const canonicalRoot = path.join(absoluteCollab, rootName);
  const physicalRoot = physicalPath(canonicalRoot);
  const physicalDestination = physicalPath(absoluteDestination);
  if (!physicalRoot || !physicalDestination || !isWithin(physicalRoot, physicalDestination)) {
    return blocked("destination_path_escape", absoluteDestination, topology.report.status, "destination resolves outside its canonical project home");
  }

  return {
    allowed: true,
    code: "target_admitted",
    destination: absoluteDestination,
    target_ref: targetRef,
    topology_status: topology.report.status,
    source_of_truth: "$COLLAB/harness-mc/system-workflow/registries/morrowise-project-topology.json",
  };
}

function runTopologyHealth({ collabRoot, registryPath }) {
  const execution = spawnSync(process.execPath, [healthScript, "--collab-root", collabRoot, "--registry", registryPath, "--format", "json"], { encoding: "utf8" });
  if (execution.signal) return { error: `topology health terminated by ${execution.signal}` };
  if (!execution.stdout.trim()) return { error: execution.stderr.trim() || "topology health returned no report" };
  try {
    return { report: JSON.parse(execution.stdout) };
  } catch (error) {
    return { error: `invalid topology health report: ${error.message}` };
  }
}

function physicalPath(candidate) {
  const suffix = [];
  let ancestor = path.resolve(candidate);
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) return null;
    suffix.unshift(path.basename(ancestor));
    ancestor = parent;
  }
  return path.join(fs.realpathSync.native(ancestor), ...suffix);
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function blocked(code, destination, topologyStatus, reason) {
  return { allowed: false, code, destination, topology_status: topologyStatus, reason };
}

function parseArgs(values) {
  const parsed = { format: "summary" };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--destination") parsed.destination = values[++index];
    else if (value === "--cwd") parsed.cwd = values[++index];
    else if (value === "--collab-root") parsed.collabRoot = values[++index];
    else if (value === "--registry") parsed.registryPath = values[++index];
    else if (value === "--format") parsed.format = values[++index];
    else throw new Error(`unsupported argument: ${value}`);
  }
  if (!parsed.destination) throw new Error("--destination is required");
  if (!["summary", "json"].includes(parsed.format)) throw new Error(`unsupported format: ${parsed.format}`);
  return parsed;
}

function isDirectExecution() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isDirectExecution()) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = admitProjectWrite(args);
    if (args.format === "json") process.stdout.write(`${JSON.stringify(result)}\n`);
    else process.stdout.write(`${result.allowed ? "READY" : "BLOCKED"}: ${result.code}${result.reason ? ` - ${result.reason}` : ""}\n`);
    process.exitCode = result.allowed ? 0 : 2;
  } catch (error) {
    const result = blocked("invalid_request", null, null, error.message);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = 2;
  }
}
