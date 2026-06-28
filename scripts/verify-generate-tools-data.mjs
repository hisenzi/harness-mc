import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tools-data-"));
const tmpCollab = path.join(tmpRoot, "collab");
const tmpMc = path.join(tmpCollab, "harness-mc");
const dataDir = path.join(tmpMc, "public", "data");

fs.mkdirSync(path.join(tmpMc, "scripts"), { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(path.join(tmpMc, "scripts", "live-tool.mjs"), "// Live harness script\n");

const snapshot = {
  generatedAt: "2026-06-01T00:00:00.000Z",
  summary: { totalSkills: 1, totalScripts: 2, totalHooks: 1 },
  skills: [
    {
      id: "worktree-commit",
      name: "worktree-commit",
      description: "snapshot skill",
      version: "1.7",
      category: "版本控制",
      groups: ["Commit gate"],
      lastModified: "2026-06-01T00:00:00.000Z",
      changelog: [],
    },
  ],
  scripts: [
    {
      name: "agent-script.mjs",
      description: "snapshot agent script",
      location: "000_Agent",
      lastModified: "2026-06-01T00:00:00.000Z",
    },
    {
      name: "old-harness-script.mjs",
      description: "old harness script",
      location: "harness-mc",
      lastModified: "2026-06-01T00:00:00.000Z",
    },
  ],
  hooks: [
    {
      event: "PreToolUse",
      matcher: "*",
      type: "command",
      command: "snapshot hook",
      statusMessage: null,
    },
  ],
  recentChanges: [],
};

fs.writeFileSync(path.join(dataDir, "tools.json"), `${JSON.stringify(snapshot, null, 2)}\n`);

execFileSync("node", [path.join(repoRoot, "scripts", "generate-tools-data.mjs")], {
  cwd: repoRoot,
  env: {
    ...process.env,
    COLLAB_DIR: tmpCollab,
    HARNESS_MC_DIR: tmpMc,
  },
  stdio: "pipe",
});

const output = JSON.parse(fs.readFileSync(path.join(dataDir, "tools.json"), "utf-8"));

assert.equal(output.summary.totalSkills, 1, "missing notyet-harness must preserve skill snapshot");
assert.equal(output.summary.totalHooks, 1, "missing .claude settings must preserve hook snapshot");
assert.equal(output.sourceStatus.skills, "snapshot");
assert.equal(output.sourceStatus.hooks, "snapshot");
assert.equal(output.sourceStatus.scripts["000_Agent"], "snapshot");
assert.equal(output.sourceStatus.scripts["harness-mc"], "scanned");
assert.ok(output.scripts.some((script) => script.location === "000_Agent" && script.name === "agent-script.mjs"));
assert.ok(output.scripts.some((script) => script.location === "harness-mc" && script.name === "live-tool.mjs"));
assert.ok(!output.scripts.some((script) => script.name === "old-harness-script.mjs"));

console.log("generate-tools-data verification passed");
