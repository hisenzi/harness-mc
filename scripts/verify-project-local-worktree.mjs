import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateWorktreeStatus } from "./generate-worktree-status.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const worktreesRoot = path.dirname(repoRoot);

if (path.basename(worktreesRoot) !== ".worktrees") {
  console.log("Project-local worktree fixture skipped outside .worktrees/<task>");
  process.exit(0);
}

const env = { ...process.env };
delete env.COLLAB_DIR;

const result = spawnSync(process.execPath, [path.join(__dirname, "verify-architecture-subsystems.mjs")], {
  cwd: repoRoot,
  encoding: "utf8",
  env,
});

assert.equal(
  result.status,
  0,
  `architecture subsystem verifier must resolve $COLLAB from a project-local worktree without COLLAB_DIR\n${result.stdout}\n${result.stderr}`,
);

const worktreeStatus = generateWorktreeStatus({ write: false });
assert.ok(
  worktreeStatus.repositories.some((repo) => repo.repo === "harness-mc"),
  "worktree status generator must scan $COLLAB rather than the nested .worktrees directory",
);

console.log("Project-local worktree fixture OK");
