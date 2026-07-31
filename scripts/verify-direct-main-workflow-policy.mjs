import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const notyetRoot = path.resolve(root, "..", "notyet-harness");
const read = (base, relativePath) =>
  fs.readFileSync(path.join(base, relativePath), "utf8");

const spec = read(root, "system-workflow/docs/specs/repo-coordination-gate.md");
const approvalSpec = read(
  root,
  "system-workflow/docs/specs/morrowise-approval-policy.md",
);
const approvalPolicy = JSON.parse(
  read(root, "system-workflow/registries/morrowise-approval-policy.json"),
);
const taskFile = JSON.parse(read(root, "milestones/morrowise/tasks.json"));
const tasks = Array.isArray(taskFile) ? taskFile : taskFile.tasks;
const task = tasks.find(
  (item) => item.id === "multi-machine-repo-coordination-gate",
);
const postCommitCloseoutTestPath = path.join(
  notyetRoot,
  "000_Agent/skills/worktree-commit/tests/verify-post-commit-closeout.test.mjs",
);
const safeFastForwardContinuationTestPath = path.join(
  notyetRoot,
  "000_Agent/skills/worktree-commit/tests/verify-safe-fast-forward-continuation.test.mjs",
);
const legacyManifest = JSON.parse(
  read(notyetRoot, "000_Agent/skills/git-worktree/dist/manifest.json"),
);
const legacyScriptPairs = [
  [
    "000_Agent/skills/git-worktree/scripts/worktree-plan.sh",
    "legacy worktree mutation modes are retired",
  ],
  [
    "000_Agent/skills/git-worktree/dist/scripts/worktree-plan.sh",
    "legacy worktree mutation modes are retired",
  ],
  [
    "000_Agent/skills/git-worktree/scripts/worktree-commit.sh",
    "legacy commit execution is retired",
  ],
  [
    "000_Agent/skills/git-worktree/dist/scripts/worktree-commit.sh",
    "legacy commit execution is retired",
  ],
  [
    "000_Agent/skills/git-worktree/scripts/worktree-pr.sh",
    "legacy PR execution is retired",
  ],
  [
    "000_Agent/skills/git-worktree/dist/scripts/worktree-pr.sh",
    "legacy PR execution is retired",
  ],
];
const notyetFiles = [
  "000_Agent/CORE.md",
  "000_Agent/skills/executing-plans/SKILL.md",
  "000_Agent/skills/using-git-worktrees/SKILL.md",
  "000_Agent/skills/git-worktree/SKILL.md",
  "000_Agent/skills/git-worktree/dist/SKILL.md",
  "000_Agent/skills/worktree-commit/SKILL.md",
  "000_Agent/skills/cc-push/SKILL.md",
];
const governedText = [
  spec,
  approvalSpec,
  JSON.stringify(approvalPolicy, null, 2),
  JSON.stringify(task, null, 2),
  ...notyetFiles.map((relativePath) => read(notyetRoot, relativePath)),
].join("\n");

assert(task, "JV-37 task must exist");
assert.match(
  spec,
  /single-developer sequential work stays on the checked-out `main`/,
  "Repo Coordination Gate must make direct main the solo sequential default",
);
assert.match(
  approvalPolicy.core_rules?.git_workflow_default || "",
  /checked-out main/,
  "approval policy must encode the checked-out main default",
);
assert(
  task.acceptance.some(
    (item) =>
      item.includes("單人循序工作") &&
      item.includes("目前 checked-out main"),
  ),
  "JV-37 acceptance must encode the solo direct-main route",
);
assert.match(
  read(notyetRoot, "000_Agent/CORE.md"),
  /單人循序工作預設留在目前 checked-out `main`/,
  "CORE must expose the direct-main default",
);
assert.match(
  spec,
  /committed_local\s*->\s*commit_reviewed\s*->\s*integrated_main\s*->\s*delivery_verified\s*->\s*canonical_applied\s*->\s*closeout_remote_synced\s*->\s*residual_zero\s*->\s*task_completed/,
  "Repo Coordination Gate must define the finite post-commit task closeout path",
);
assert.match(
  spec,
  /all mutating closeout work.*before.*C2 closeout commit/is,
  "Repo Coordination Gate must place all expected mutations before C2",
);
assert.match(
  spec,
  /C2.*must not.*backfill.*own.*hash/is,
  "Repo Coordination Gate must terminate without a self-hash backfill",
);
assert.match(
  spec,
  /after C2.*read-only/is,
  "Repo Coordination Gate must make the final terminal verification read-only",
);
assert.match(
  spec,
  /safe_non_overlapping_fast_forward/,
  "Repo Coordination Gate must define the bounded safe fast-forward continuation",
);
assert.match(
  spec,
  /Git commit 識別碼（commit SHA）/,
  "Repo Coordination Gate must introduce commit SHA with the shared user-facing terminology",
);
const commitIdentifierIntroduction = "Git commit 識別碼（commit SHA）";
assert.equal(
  spec.indexOf("commit SHA"),
  spec.indexOf(commitIdentifierIntroduction) +
    commitIdentifierIntroduction.indexOf("commit SHA"),
  "Repo Coordination Gate must introduce the full term before using commit SHA",
);
const postCommitAcceptance = task.acceptance.find((item) =>
  item.startsWith("A05.1｜worktree-commit v2.2 post-commit closeout"),
);
assert.ok(postCommitAcceptance, "JV-37 must carry the v2.2 post-commit closeout amendment");
assert.match(
  postCommitAcceptance,
  /committed_local -> commit_reviewed -> integrated_main -> delivery_verified -> canonical_applied -> closeout_remote_synced -> residual_zero -> task_completed/,
  "JV-37 A05.1 must carry the finite task closeout path",
);
assert.match(
  postCommitAcceptance,
  /mutating generator.*C2.*C2 不回填自身 hash/is,
  "JV-37 A05.1 must terminate all mutations before C2 without self-hash backfill",
);
assert.match(
  read(notyetRoot, "000_Agent/skills/executing-plans/SKILL.md"),
  /Execute the plan in the checked-out `main` working directory by default/,
  "executing-plans must not force a branch or worktree",
);
assert.deepEqual(
  legacyManifest.commands.map((command) => command.id),
  ["worktree-plan"],
  "legacy manifest must not expose commit or PR mutation commands",
);
for (const [relativePath, refusalMessage] of legacyScriptPairs) {
  assert.match(
    read(notyetRoot, relativePath),
    new RegExp(refusalMessage),
    `${relativePath} must refuse its retired mutation entrypoint`,
  );
}

const closeoutContractResult = spawnSync(
  process.execPath,
  [postCommitCloseoutTestPath],
  { encoding: "utf8" },
);
assert.equal(
  closeoutContractResult.status,
  0,
  closeoutContractResult.stderr || closeoutContractResult.stdout,
);
const safeFastForwardContinuationResult = spawnSync(
  process.execPath,
  [safeFastForwardContinuationTestPath],
  { encoding: "utf8" },
);
assert.equal(
  safeFastForwardContinuationResult.status,
  0,
  safeFastForwardContinuationResult.stderr ||
    safeFastForwardContinuationResult.stdout,
);

for (const pattern of [
  /Use one normal working directory and a short-lived branch/i,
  /單人.*(?:預設|改用).*短期 branch/i,
  /單人一般 branch/i,
  /正常 branch/i,
  /Never start implementation on main\/master/i,
  /using-git-worktrees.*REQUIRED.*isolated workspace/i,
]) {
  assert.equal(
    pattern.test(governedText),
    false,
    `governed policy retains a branch-first fallback: ${pattern}`,
  );
}

console.log("direct-main workflow policy verification OK");
