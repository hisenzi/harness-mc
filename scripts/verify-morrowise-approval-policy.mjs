import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const policyPath = path.join(root, "system-workflow", "registries", "morrowise-approval-policy.json");
const specPath = path.join(root, "system-workflow", "docs", "specs", "morrowise-approval-policy.md");
const schemaPath = path.join(root, "system-workflow", "schemas", "morrowise-system.schema.json");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

const policy = JSON.parse(fs.readFileSync(policyPath, "utf-8"));
const spec = fs.readFileSync(specPath, "utf-8");
const schema = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));

assert(policy.policy_id === "morrowise-approval-policy.v0", "unexpected policy_id");
assert(policy.task_id === "morrowise-approval-policy", "unexpected task_id");
assert(policy.runner_gate?.default_policy === "approval_required", "default policy must be approval_required");
assert(policy.core_rules?.direction_agreement_is_not_operation_approval === true, "direction agreement rule missing");
assert(
  policy.core_rules?.commit_boundary_rule?.includes("worktree-commit confirmation gate"),
  "commit boundary rule must require worktree-commit confirmation gate"
);
assert(
  policy.core_rules?.worktree_commit_gate_rule?.includes("dirty-tree scan") &&
    policy.core_rules?.worktree_commit_gate_rule?.includes("4C review") &&
    policy.core_rules?.worktree_commit_gate_rule?.includes("Vincent confirmation"),
  "worktree commit gate rule must require dirty-tree scan, 4C review, and Vincent confirmation"
);
assert(Array.isArray(policy.sources_reviewed) && policy.sources_reviewed.length >= 10, "sources_reviewed too small");

const tiers = new Map(policy.policy_tiers.map((tier) => [tier.policy, tier]));
for (const tier of ["allowed", "approval_required", "forbidden"]) {
  assert(tiers.has(tier), `missing policy tier: ${tier}`);
  assert(Array.isArray(tiers.get(tier).rules) && tiers.get(tier).rules.length > 0, `${tier}: rules required`);
}

const allowed = new Set(tiers.get("allowed").rules.map((rule) => rule.action_class));
const approvalRequired = new Set(tiers.get("approval_required").rules.map((rule) => rule.action_class));
const forbidden = new Set(tiers.get("forbidden").rules.map((rule) => rule.action_class));

for (const actionClass of [
  "read_mc_docs_tasks_public_data",
  "generate_local_read_model",
  "dry_run_or_preview",
  "low_risk_local_verification",
  "draft_patch_inside_active_task",
]) {
  assert(allowed.has(actionClass), `allowed class missing: ${actionClass}`);
}

for (const actionClass of [
  "task_state_mutation",
  "memory_write_or_update",
  "schedule_mutation",
  "external_sync_or_write",
  "third_party_repo_skill_intake",
  "commit_push_deploy",
  "worktree_commit_gate",
  "visual_layer_overwrite_or_reverse_sync",
  "browser_submit_or_message",
]) {
  assert(approvalRequired.has(actionClass), `approval_required class missing: ${actionClass}`);
}

for (const actionClass of [
  "read_or_output_secrets",
  "bypass_vincent_approval",
  "reverse_write_from_visual_or_chat",
  "destructive_without_recovery",
  "history_rewrite_without_explicit_request",
  "unreviewed_third_party_execution",
]) {
  assert(forbidden.has(actionClass), `forbidden class missing: ${actionClass}`);
}

for (const tier of policy.policy_tiers) {
  for (const rule of tier.rules) {
    assert(nonEmpty(rule.action_class), `${tier.policy}: action_class required`);
    assert(nonEmpty(rule.reason), `${rule.action_class}: reason required`);
    if (tier.policy === "approval_required") {
      assert(Array.isArray(rule.required_evidence) && rule.required_evidence.length > 0, `${rule.action_class}: required_evidence required`);
    }
    if (tier.policy === "allowed") {
      assert(Array.isArray(rule.conditions) && rule.conditions.length > 0, `${rule.action_class}: conditions required`);
    }
  }
}

const commitRule = tiers.get("approval_required").rules.find((rule) => rule.action_class === "commit_push_deploy");
assert(commitRule.runner_limit?.includes("commit plan or draft patch"), "commit_push_deploy must limit runner to commit plan or draft patch");
assert(commitRule.runner_limit?.includes("worktree_commit_gate"), "commit_push_deploy must reclassify actual commit as worktree_commit_gate");

const worktreeCommitRule = tiers.get("approval_required").rules.find((rule) => rule.action_class === "worktree_commit_gate");
assert(worktreeCommitRule, "worktree_commit_gate rule required");
for (const evidence of ["dirty-tree scan", "full diff review", "4C review", "path policy check", "Vincent confirmation"]) {
  assert(worktreeCommitRule.required_evidence.includes(evidence), `worktree_commit_gate evidence missing: ${evidence}`);
}
assert(worktreeCommitRule.runner_limit?.includes("explicit Vincent confirmation"), "worktree_commit_gate must require explicit Vincent confirmation");
assert(
  policy.runner_gate.decision_order.some((step) => step.includes("worktree_commit_gate") && step.includes("before git commit runs")),
  "runner gate must include worktree_commit_gate before git commit runs"
);

for (const requiredInput of ["recommendation_id", "suggested_action", "risk_level", "requires_approval", "evidence_refs", "suggested_task_id"]) {
  assert(policy.runner_gate.input_required.includes(requiredInput), `runner input missing: ${requiredInput}`);
}

const schemaApproval = schema.$defs?.approvalRule;
assert(schemaApproval, "schema missing approvalRule definition");
for (const field of ["action_class", "policy", "reason", "required_evidence"]) {
  assert(schemaApproval.properties[field], `schema approvalRule missing property: ${field}`);
}
assert(schemaApproval.required.includes("reason"), "schema approvalRule.reason must be required");

for (const phrase of [
  "Direction agreement is not operation approval",
  "Tier 1: Allowed",
  "Tier 2: Approval Required",
  "Tier 3: Forbidden",
  "Runner Gate",
  "commit plan or draft patch",
  "worktree-commit",
  "worktree_commit_gate",
  "4C",
  "npm run test:morrowise-approval",
]) {
  assert(spec.includes(phrase), `spec missing phrase: ${phrase}`);
}

const sharedText = `${JSON.stringify(policy, null, 2)}\n${spec}`;
assert(!/\/Users\/[A-Za-z]+\//.test(sharedText), "shared approval policy must not hard-code local user paths");

console.log("MorroWise approval policy verification OK");
