#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { admitProjectWrite } from "./project-write-admission.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const collabRoot = path.resolve(process.env.COLLAB_ROOT || path.dirname(repoRoot));
const registryPath = path.resolve(process.env.PROJECT_TOPOLOGY_REGISTRY || path.join(repoRoot, "system-workflow", "registries", "morrowise-project-topology.json"));

try {
  const payload = JSON.parse(fs.readFileSync(0, "utf8"));
  const cwd = path.resolve(payload.cwd || process.cwd());
  const destinations = extractDestinations(payload.tool_input || {});
  if (destinations.length === 0) stop("destination_missing", "write tool input did not expose a destination");

  for (const destination of destinations) {
    const absolute = path.resolve(cwd, destination);
    if (isSharedControlFile(absolute)) continue;
    const result = admitProjectWrite({ destination, cwd, collabRoot, registryPath });
    if (!result.allowed) stop(result.code, result.reason);
  }
} catch (error) {
  stop("hook_input_invalid", error.message);
}

function extractDestinations(input) {
  const values = [];
  for (const field of ["file_path", "filePath", "path"]) {
    if (typeof input[field] === "string" && input[field].trim()) values.push(input[field].trim());
  }
  if (typeof input.command === "string") {
    for (const line of input.command.split(/\r?\n/)) {
      const match = line.match(/^\*\*\* (?:Add File|Delete File|Update File|Move to): (.+)$/);
      if (match) values.push(match[1].trim());
    }
  }
  return [...new Set(values)];
}

function isSharedControlFile(candidate) {
  return [
    path.join(collabRoot, "AGENTS.md"),
    path.join(collabRoot, ".codex", "hooks.json"),
    path.join(collabRoot, ".claude", "settings.json"),
  ].includes(candidate);
}

function stop(code, reason) {
  process.stderr.write(`PROJECT_WRITE_BLOCKED ${code}: ${reason}\n`);
  process.exit(2);
}
