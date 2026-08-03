#!/usr/bin/env node

import path from "node:path";
import {
  discoverMilestoneProjects,
  publicMilestoneDescriptor,
  resolveMilestoneProject,
  validateMilestoneCandidate,
} from "./lib/milestone-projects.mjs";

function parseArgs(argv) {
  const args = { command: argv[0] || "list", repoRoot: process.cwd(), projectId: null, group: null, folderDate: null };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") args.repoRoot = path.resolve(argv[++index]);
    else if (arg === "--id") args.projectId = argv[++index];
    else if (arg === "--group") args.group = argv[++index];
    else if (arg === "--folder-date") args.folderDate = argv[++index];
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  let result;
  if (args.command === "list") {
    result = discoverMilestoneProjects({ repoRoot: args.repoRoot }).map(publicMilestoneDescriptor);
  } else if (args.command === "resolve") {
    if (!args.projectId) throw new Error("resolve requires --id");
    const descriptor = resolveMilestoneProject({ repoRoot: args.repoRoot, projectId: args.projectId });
    if (!descriptor) throw new Error(`unknown milestone project ID: ${args.projectId}`);
    result = publicMilestoneDescriptor(descriptor);
  } else if (args.command === "candidate") {
    if (!args.projectId) throw new Error("candidate requires --id");
    result = validateMilestoneCandidate({
      repoRoot: args.repoRoot,
      projectId: args.projectId,
      group: args.group,
      folderDate: args.folderDate,
    });
  } else {
    throw new Error(`unknown command: ${args.command}`);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`milestone project index BLOCKED: ${error.message}\n`);
  process.exitCode = 2;
}
