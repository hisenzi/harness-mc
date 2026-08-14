#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeTaskEvent } from "./task-event-outbox.mjs";
import {
  acquireRemoteClaim,
  classifyRepoSnapshot,
  inspectAuthorizationContinuation,
  inspectCloseoutState,
  inspectTerminalCloseout,
  finalizeRemoteCloseout,
  preparePilotObservation,
  prepareRemoteRelease,
  recordC1Delivery,
  integrateC1Deliveries,
  recordPilotObservation,
  recordVerifierEvidence,
  repoReady,
  transitionRemoteClaim,
  validatePilotReceipt,
} from "./lib/repo-coordination-runtime.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const options = parseArgs(process.argv.slice(2));
let result;

if (options.command === "event") {
  const input = readJson(options.inputPath);
  const event = writeTaskEvent({ ...input, root: options.root });
  result = { decision: "READY", reason: "coordination_event_written", event };
} else if (options.command === "classify") {
  result = classifyRepoSnapshot(readJson(options.inputPath));
} else if (options.command === "repo-ready") {
  requireOption(options.repoPath, "--repo <path>");
  result = repoReady(options.repoPath, {
    autoFf: options.autoFf,
    exclusions: options.exclusions,
    commitScope: options.commitScope,
    signedRecord: options.signedObservationPath ? readJson(options.signedObservationPath) : null,
  });
} else if (options.command === "remote-claim") {
  const input = readJson(options.inputPath);
  requireOption(options.repoPath, "--repo <path>");
  result = acquireRemoteClaim({ repoPath: options.repoPath, remote: options.remote, claim: input });
} else if (options.command === "record-c1-delivery") {
  requireOption(options.repoPath, "--repo <path>");
  requireOption(options.projectId, "--project <id>");
  requireOption(options.taskId, "--task <id>");
  requireOption(options.sessionId, "--session <id>");
  requireOption(options.actor, "--actor <id>");
  requireOption(options.baseSha, "--base <sha>");
  requireOption(options.commitSha, "--commit <sha>");
  result = recordC1Delivery({
    repoPath: options.repoPath,
    remote: options.remote,
    projectId: options.projectId,
    taskId: options.taskId,
    environmentId: options.environmentId,
    sessionId: options.sessionId,
    actor: options.actor,
    baseSha: options.baseSha,
    commitSha: options.commitSha,
    scopePaths: options.commitScope,
  });
} else if (options.command === "integrate-c1-deliveries") {
  const input = readJson(options.inputPath);
  requireOption(options.repoPath, "--repo <path>");
  result = integrateC1Deliveries({
    repoPath: options.repoPath,
    remote: options.remote,
    claim: input.claim,
    deliveries: input.deliveries,
  });
} else if (options.command === "remote-transition") {
  const input = readJson(options.inputPath);
  requireOption(options.repoPath, "--repo <path>");
  requireOption(options.nextState, "--to <state>");
  result = transitionRemoteClaim({
    repoPath: options.repoPath,
    remote: options.remote,
    projectId: input.project_id,
    taskId: input.task_id,
    claim: input,
    nextState: options.nextState,
    performedBySessionId: options.sessionId,
    evidence: options.evidencePath ? readJson(options.evidencePath) : {},
  });
} else if (options.command === "prepare-release") {
  const input = readJson(options.inputPath);
  requireOption(options.repoPath, "--repo <path>");
  result = prepareRemoteRelease({
    repoPath: options.repoPath,
    remote: options.remote,
    projectId: input.project_id,
    taskId: input.task_id,
    claim: input,
    performedBySessionId: options.sessionId,
  });
} else if (options.command === "finalize-closeout") {
  requireOption(options.repoPath, "--repo <path>");
  requireOption(options.c1Sha, "--c1 <sha>");
  requireOption(options.c2Sha, "--c2 <sha>");
  result = finalizeRemoteCloseout({
    repoPath: options.repoPath,
    remote: options.remote,
    prepared: readJson(options.inputPath),
    c1Sha: options.c1Sha,
    c2Sha: options.c2Sha,
  });
} else if (options.command === "next") {
  requireOption(options.repoPath, "--repo <path>");
  requireOption(options.projectId, "--project <id>");
  requireOption(options.taskId, "--task <id>");
  result = inspectCloseoutState({
    repoPath: options.repoPath,
    root: options.root,
    remote: options.remote,
    projectId: options.projectId,
    taskId: options.taskId,
  });
} else if (options.command === "authorization") {
  requireOption(options.repoPath, "--repo <path>");
  result = inspectAuthorizationContinuation({
    repoPath: options.repoPath,
    remote: options.remote,
    approved: readJson(options.approvedPath),
    current: readJson(options.currentPath),
  });
} else if (options.command === "terminal") {
  requireOption(options.repoPath, "--repo <path>");
  requireOption(options.projectId, "--project <id>");
  requireOption(options.taskId, "--task <id>");
  result = inspectTerminalCloseout({
    repoPath: options.repoPath,
    root: options.root,
    remote: options.remote,
    projectId: options.projectId,
    taskId: options.taskId,
    c1Sha: options.c1Sha,
    c2Sha: options.c2Sha,
    scopePaths: options.commitScope,
  });
} else if (options.command === "prepare-pilot-observation") {
  requireOption(options.repoPath, "--repo <path>");
  result = preparePilotObservation({
    repoPath: options.repoPath,
    remote: options.remote,
    pilotId: options.pilotId,
    environmentId: options.environmentId,
    sessionId: options.sessionId,
    observedAt: options.observedAt,
    exclusions: options.exclusions,
    commitScope: options.commitScope,
  });
} else if (options.command === "record-pilot-observation") {
  requireOption(options.repoPath, "--repo <path>");
  const signedRecord = options.signedObservationPath ? readJson(options.signedObservationPath) : null;
  result = recordPilotObservation({
    repoPath: options.repoPath,
    remote: options.remote,
    pilotId: options.pilotId,
    environmentId: options.environmentId,
    sessionId: options.sessionId,
    observedAt: options.observedAt || signedRecord?.observed_at,
    exclusions: options.exclusions,
    commitScope: options.commitScope,
    signedRecord,
  });
} else if (options.command === "record-verifier-evidence") {
  requireOption(options.repoPath, "--repo <path>");
  requireOption(options.pilotId, "--pilot-id <id>");
  result = recordVerifierEvidence({
    repoPath: options.repoPath,
    remote: options.remote,
    tasksPath: options.tasksPath,
    taskId: options.taskId || "multi-machine-repo-coordination-gate",
    pilotId: options.pilotId,
  });
} else if (options.command === "pilot") {
  requireOption(options.repoPath, "--repo <path>");
  result = validatePilotReceipt(readJson(options.inputPath), {
    repoPath: options.repoPath,
    root: options.root,
    remote: options.remote,
    tasksPath: options.tasksPath,
  });
} else {
  throw new Error(`unknown command: ${options.command || "missing"}`);
}

console.log(JSON.stringify(result, null, 2));
if (result.decision === "BLOCKED") process.exitCode = 2;

function parseArgs(argv) {
  const options = {
    command: argv[0] || null,
    inputPath: null,
    approvedPath: null,
    currentPath: null,
    evidencePath: null,
    signedObservationPath: null,
    root: repoRoot,
    repoPath: null,
    tasksPath: path.join(repoRoot, "milestones", "morrowise", "tasks.json"),
    projectId: null,
    taskId: null,
    nextState: null,
    c1Sha: null,
    c2Sha: null,
    baseSha: null,
    commitSha: null,
    actor: null,
    pilotId: null,
    environmentId: null,
    sessionId: null,
    observedAt: null,
    remote: "origin",
    autoFf: false,
    exclusions: [],
    commitScope: [],
  };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--input" || arg === "--receipt") options.inputPath = argv[++index] || null;
    else if (arg === "--approved") options.approvedPath = argv[++index] || null;
    else if (arg === "--current") options.currentPath = argv[++index] || null;
    else if (arg === "--evidence") options.evidencePath = argv[++index] || null;
    else if (arg === "--signed-observation") options.signedObservationPath = argv[++index] || null;
    else if (arg === "--root") options.root = path.resolve(argv[++index] || ".");
    else if (arg === "--repo") options.repoPath = path.resolve(argv[++index] || ".");
    else if (arg === "--tasks") options.tasksPath = path.resolve(argv[++index] || "");
    else if (arg === "--project") options.projectId = argv[++index] || null;
    else if (arg === "--task") options.taskId = argv[++index] || null;
    else if (arg === "--to") options.nextState = argv[++index] || null;
    else if (arg === "--c1") options.c1Sha = argv[++index] || null;
    else if (arg === "--c2") options.c2Sha = argv[++index] || null;
    else if (arg === "--base") options.baseSha = argv[++index] || null;
    else if (arg === "--commit") options.commitSha = argv[++index] || null;
    else if (arg === "--actor") options.actor = argv[++index] || null;
    else if (arg === "--pilot-id") options.pilotId = argv[++index] || null;
    else if (arg === "--environment") options.environmentId = argv[++index] || null;
    else if (arg === "--session") options.sessionId = argv[++index] || null;
    else if (arg === "--observed-at") options.observedAt = argv[++index] || null;
    else if (arg === "--remote") options.remote = argv[++index] || "origin";
    else if (arg === "--auto-ff") options.autoFf = true;
    else if (arg === "--exclude") options.exclusions.push(argv[++index] || "");
    else if (arg === "--scope-path") options.commitScope.push(argv[++index] || "");
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function readJson(filePath) {
  if (!filePath) throw new Error("JSON input path is required");
  return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
}

function requireOption(value, syntax) {
  if (!value) throw new Error(`${syntax} is required`);
}
