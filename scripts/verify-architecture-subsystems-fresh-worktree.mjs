import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptsDir, "..");
assert.match(root, /harness-mc\/\.worktrees\//, "this regression test must run from a nested fresh worktree");

const result = spawnSync(process.execPath, ["scripts/verify-architecture-subsystems.mjs"], {
  cwd: root,
  encoding: "utf8",
});

assert.equal(
  result.status,
  0,
  `nested fresh worktree must resolve $COLLAB before reading ARCHITECTURE.md:\n${result.stderr || result.stdout}`,
);

console.log("fresh-worktree Architecture Subsystems verification passed");
