#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { resolveCollabRoot } from "./collab-root.mjs";

const root = resolveCollabRoot(path.resolve(import.meta.dirname, ".."));
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf-8");

const contract = read("harness-mc/system-workflow/docs/specs/repo-coordination-gate.md");
assert.match(contract, /## Solo Development Default/);
assert.match(contract, /sequential_single_task[\s\S]{0,320}一般 branch/);
assert.match(contract, /known_unrelated_dirty[\s\S]{0,320}不得以 worktree/);
assert.match(contract, /fresh_baseline_verification[\s\S]{0,320}verification/);
assert.match(contract, /\$COLLAB\/harness-mc\/scripts\/worktree-exception-preflight\.mjs/);
assert.match(contract, /new short-lived branch[\s\S]{0,320}no upstream/);

const worktreeSkill = read("notyet-harness/000_Agent/skills/using-git-worktrees/SKILL.md");
assert.match(worktreeSkill, /Use when a documented worktree exception applies/);
assert.match(worktreeSkill, /worktree-exception-preflight/);
assert.match(worktreeSkill, /\$COLLAB\/harness-mc\/scripts\/worktree-exception-preflight\.mjs/);
assert.match(worktreeSkill, /health:project-topology/);
assert.doesNotMatch(worktreeSkill, /before executing implementation plans - creates isolated/i);

const gitWorktreeSkill = read("notyet-harness/000_Agent/skills/git-worktree/SKILL.md");
const gitWorktreeDistSkill = read("notyet-harness/000_Agent/skills/git-worktree/dist/SKILL.md");
const gitWorktreeScript = read("notyet-harness/000_Agent/skills/git-worktree/scripts/worktree-plan.sh");
const gitWorktreeDistScript = read("notyet-harness/000_Agent/skills/git-worktree/dist/scripts/worktree-plan.sh");
const gitWorktreeManifest = read("notyet-harness/000_Agent/skills/git-worktree/dist/manifest.json");
for (const artifact of [gitWorktreeSkill, gitWorktreeDistSkill, gitWorktreeScript, gitWorktreeDistScript, gitWorktreeManifest]) {
  assert.match(artifact, /worktree-exception-preflight/);
}
assert.match(gitWorktreeSkill, /--worktree-reason/);
assert.match(gitWorktreeSkill, /subagent-review.*停用/);
assert.match(gitWorktreeScript, /require_worktree_exception/);
assert.match(gitWorktreeDistScript, /require_worktree_exception/);
assert.match(gitWorktreeScript, /grep -q '\^status: blocked'/);
assert.match(gitWorktreeDistScript, /grep -q '\^status: blocked'/);
assert.match(gitWorktreeScript, /run_subagent_review\(\) \{\s+die "legacy subagent-review 已停用/);
assert.doesNotMatch(gitWorktreeManifest, /"id": "worktree-(commit|pr)"/);

const notyetRoot = path.join(root, "notyet-harness");
const gitignorePath = path.join(notyetRoot, ".gitignore");
const gitignoreBefore = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, "utf-8") : null;
const worktreesBefore = spawnSync("git", ["worktree", "list", "--porcelain"], {
  cwd: notyetRoot,
  encoding: "utf8",
});
assert.equal(worktreesBefore.status, 0, "must snapshot worktree topology before refusal tests");
for (const scriptPath of [
  "000_Agent/skills/git-worktree/scripts/worktree-plan.sh",
  "000_Agent/skills/git-worktree/dist/scripts/worktree-plan.sh",
]) {
  const result = spawnSync("bash", [
    scriptPath,
    "--execute", "/private/tmp/nonexistent-worktree-plan.json",
    "--repo", ".",
    "--worktree-reason", "sequential_single_task",
    "--evidence-ref", "test: single sequential task",
  ], {
    cwd: notyetRoot,
    env: { ...process.env, COLLAB: root },
    encoding: "utf8",
  });
  assert.equal(result.status, 1, `${scriptPath} must reject a non-exception before creating a worktree`);
  assert.match(`${result.stdout}\n${result.stderr}`, /要求改走一般 branch/);
}
const gitignoreAfter = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, "utf-8") : null;
assert.equal(gitignoreAfter, gitignoreBefore, "rejected worktree creation must not mutate .gitignore");
const worktreesAfter = spawnSync("git", ["worktree", "list", "--porcelain"], {
  cwd: notyetRoot,
  encoding: "utf8",
});
assert.equal(worktreesAfter.status, 0, "must snapshot worktree topology after refusal tests");
assert.equal(worktreesAfter.stdout, worktreesBefore.stdout, "rejected worktree creation must not mutate worktree topology");

const legacyReview = spawnSync("bash", [
  "000_Agent/skills/git-worktree/scripts/worktree-plan.sh",
  "--mode", "subagent-review",
], {
  cwd: notyetRoot,
  encoding: "utf8",
});
assert.equal(legacyReview.status, 1, "legacy subagent-review must not write old task or memory paths");
assert.match(`${legacyReview.stdout}\n${legacyReview.stderr}`, /subagent-review 已停用/);

for (const scriptPath of [
  "000_Agent/skills/git-worktree/scripts/worktree-commit.sh",
  "000_Agent/skills/git-worktree/scripts/worktree-pr.sh",
  "000_Agent/skills/git-worktree/dist/scripts/worktree-commit.sh",
  "000_Agent/skills/git-worktree/dist/scripts/worktree-pr.sh",
]) {
  const result = spawnSync("bash", [scriptPath], {
    cwd: notyetRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, 64, `${scriptPath} must be a retired route`);
  assert.match(`${result.stdout}\n${result.stderr}`, /已退役/);
}

const executingPlans = read("notyet-harness/000_Agent/skills/executing-plans/SKILL.md");
assert.doesNotMatch(executingPlans, /using-git-worktrees\*\* - REQUIRED: Set up isolated workspace/);
assert.match(executingPlans, /worktree-exception-preflight/);

const subagentDevelopment = read("notyet-harness/000_Agent/skills/subagent-driven-development/SKILL.md");
assert.doesNotMatch(subagentDevelopment, /using-git-worktrees\*\* - REQUIRED: Set up isolated workspace/);
assert.match(subagentDevelopment, /worktree-exception-preflight/);

const finishingBranch = read("notyet-harness/000_Agent/skills/finishing-a-development-branch/SKILL.md");
assert.match(finishingBranch, /only if this branch used a linked worktree/i);

const commitSkill = read("notyet-harness/000_Agent/skills/worktree-commit/SKILL.md");
assert.match(commitSkill, /does not require a Git worktree/i);

const pushSkill = read("notyet-harness/000_Agent/skills/cc-push/SKILL.md");
assert.match(pushSkill, /lowest-mutation reconcile path/i);

console.log("Solo workflow policy verification OK");
