import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const notyetArgIndex = process.argv.indexOf("--notyet-root");
const notyetRoot =
  notyetArgIndex >= 0
    ? path.resolve(process.argv[notyetArgIndex + 1])
    : path.resolve(root, "..", "notyet-harness");

const read = (base, relativePath) =>
  fs.readFileSync(path.join(base, relativePath), "utf8");

const contractId = "MW-GIT-AUTH-01";
const harnessFiles = [
  "system-workflow/docs/specs/repo-coordination-gate.md",
  "system-workflow/docs/specs/morrowise-approval-policy.md",
  "milestones/morrowise/tasks.json",
  "system-workflow/registries/morrowise-approval-policy.json",
];
const notyetFiles = [
  "000_Agent/CORE.md",
  "000_Agent/skills/using-git-worktrees/SKILL.md",
  "000_Agent/skills/git-worktree/SKILL.md",
  "000_Agent/skills/git-worktree/dist/SKILL.md",
  "000_Agent/skills/worktree-commit/SKILL.md",
  "000_Agent/skills/cc-push/SKILL.md",
  "000_Agent/skills/finishing-a-development-branch/SKILL.md",
];

for (const relativePath of harnessFiles) {
  assert.match(
    read(root, relativePath),
    new RegExp(contractId),
    `${relativePath} must reference ${contractId}`,
  );
}

for (const relativePath of notyetFiles) {
  assert.match(
    read(notyetRoot, relativePath),
    new RegExp(contractId),
    `${relativePath} must reference ${contractId}`,
  );
}

assert(
  !read(notyetRoot, "000_Agent/skills/git-worktree/SKILL.md").includes(
    "- base_sha:",
  ),
  "base_sha is a pre-execution handshake, not an extra Vincent authorization field",
);

const coordinationSpec = read(
  root,
  "system-workflow/docs/specs/repo-coordination-gate.md",
);
assert.match(
  coordinationSpec,
  /Creating or switching a Git branch or linked worktree requires explicit Vincent approval\./,
  "Repo Coordination Gate must block autonomous branch/worktree creation and switching",
);
assert.match(
  coordinationSpec,
  /create -> execute -> integrate target main -> verify -> remove the temporary branch\/worktree/,
  "one authorization must own the complete temporary isolation lifecycle",
);

const approvalPolicy = JSON.parse(
  read(root, "system-workflow/registries/morrowise-approval-policy.json"),
);
const approvalRequired = approvalPolicy.policy_tiers.find(
  (tier) => tier.policy === "approval_required",
);
const isolationRule = approvalRequired?.rules.find(
  (rule) => rule.action_class === "git_isolation_mutation",
);
assert(isolationRule, "approval policy must define git_isolation_mutation");
for (const evidence of [
  "exact Vincent approval",
  "repo and task id",
  "branch/worktree name and path",
  "target main",
  "cleanup plan",
]) {
  assert(
    isolationRule.required_evidence?.includes(evidence),
    `git_isolation_mutation evidence missing: ${evidence}`,
  );
}

const taskFile = JSON.parse(read(root, "milestones/morrowise/tasks.json"));
const tasks = Array.isArray(taskFile) ? taskFile : taskFile.tasks;
const task = tasks.find(
  (item) => item.id === "multi-machine-repo-coordination-gate",
);
assert(task, "JV-37 task must exist");
assert(
  task.acceptance.some(
    (item) => item.includes(contractId) && item.includes("Vincent"),
  ),
  `JV-37 acceptance must encode ${contractId}`,
);

const bannedDefaults = [
  "branch is the single-developer default",
  "使用同一工作目錄的一般 branch",
  "temporary clean worktree",
  "改用獨立 worktree",
];
const governedText = [
  coordinationSpec,
  ...notyetFiles.map((relativePath) => read(notyetRoot, relativePath)),
].join("\n");
for (const phrase of bannedDefaults) {
  assert(
    !governedText.includes(phrase),
    `governed contracts must not retain autonomous fallback: ${phrase}`,
  );
}

console.log("explicit Git isolation approval verification passed");
