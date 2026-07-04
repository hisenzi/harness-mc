import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "commit-race-"));

try {
  run("git", ["init"], tmpRoot);
  run("git", ["config", "user.name", "Commit Race Fixture"], tmpRoot);
  run("git", ["config", "user.email", "fixture@example.invalid"], tmpRoot);

  fs.writeFileSync(path.join(tmpRoot, "own.txt"), "base own\n");
  fs.writeFileSync(path.join(tmpRoot, "other.txt"), "base other\n");
  run("git", ["add", "own.txt", "other.txt"], tmpRoot);
  run("git", ["commit", "-m", "base"], tmpRoot);

  fs.writeFileSync(path.join(tmpRoot, "other.txt"), "other staged by another session\n");
  run("git", ["add", "other.txt"], tmpRoot);

  fs.writeFileSync(path.join(tmpRoot, "own.txt"), "own change for this session\n");
  const scope = ["own.txt"];

  const lockPath = run("git", ["rev-parse", "--git-path", "codex-commit.lock"], tmpRoot).stdout.trim();
  fs.mkdirSync(path.join(tmpRoot, lockPath));
  assert.throws(() => fs.mkdirSync(path.join(tmpRoot, lockPath)), /EEXIST/);

  run("git", ["add", "--", ...scope], tmpRoot);
  assert.deepEqual(stagedFiles(tmpRoot), ["other.txt", "own.txt"]);

  run("git", ["commit", "--only", "-m", "test: scoped commit", "--", ...scope], tmpRoot);
  fs.rmSync(path.join(tmpRoot, lockPath), { recursive: true, force: true });

  const committedFiles = run("git", ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"], tmpRoot)
    .stdout.trim().split(/\r?\n/).filter(Boolean);
  assert.deepEqual(committedFiles, ["own.txt"]);

  assert.deepEqual(stagedFiles(tmpRoot), ["other.txt"]);
  assert.equal(fs.readFileSync(path.join(tmpRoot, "other.txt"), "utf8"), "other staged by another session\n");

  console.log("Worktree commit race governance verification OK");
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

function stagedFiles(cwd) {
  const output = run("git", ["diff", "--cached", "--name-only"], cwd).stdout.trim();
  return output ? output.split(/\r?\n/).sort() : [];
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  }
  return result;
}
