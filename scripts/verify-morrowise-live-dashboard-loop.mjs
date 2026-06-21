import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { generateMorrowiseLiveDashboard } from "./generate-morrowise-live-dashboard.mjs";
import { runMorrowiseActionRunner } from "./morrowise-action-runner.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

for (const script of [
  "generate-data.mjs",
  "generate-task-event-data.mjs",
  "generate-morrowise-proactive-loop.mjs",
  "generate-worktree-status.mjs",
  "sentinel-diff.mjs",
]) {
  execFileSync("node", [path.join("scripts", script)], { cwd: root, stdio: "inherit" });
}

const dashboard = generateMorrowiseLiveDashboard({ root });
const proactive = readJson(path.join(root, "public", "data", "morrowise-proactive-loop.json"));

assert.equal(dashboard.read_only, true);
assert.equal(dashboard.schema_version, "morrowise-live-dashboard.v0");
assert.ok(Array.isArray(dashboard.loop_chain), "dashboard.loop_chain missing");
assert.equal(dashboard.loop_chain.length, proactive.scenarios.length);

const chainsById = new Map(dashboard.loop_chain.map((chain) => [chain.id, chain]));
for (const scenario of proactive.scenarios) {
  const chain = chainsById.get(scenario.scenario_id);
  assert.ok(chain, `dashboard loop chain missing ${scenario.scenario_id}`);
  assert.equal(chain.read_only, true);
  assert.equal(chain.source_surface_id, "morrowise_proactive_loop");

  for (const stage of ["trigger", "recommendation", "approval", "action", "feedback"]) {
    assert.ok(chain.stages[stage], `${scenario.scenario_id}.${stage} missing in dashboard loop chain`);
  }

  assert.equal(chain.stages.trigger.trigger_id, scenario.trigger.trigger_id);
  assert.equal(chain.stages.recommendation.recommendation_id, scenario.recommendation.recommendation_id);
  assert.equal(chain.stages.approval.policy, scenario.approval.policy);
  assert.equal(chain.stages.action.output_type, scenario.action.output_type);
  assert.equal(chain.stages.feedback.status, scenario.feedback.status);
  assert.ok(Array.isArray(chain.evidence_refs));
  assert.ok(chain.evidence_refs.length > 0, `${scenario.scenario_id} should carry evidence refs`);
  assert.ok(chain.write_boundary.includes("not executed from the dashboard"));

  if (chain.stages.approval.requires_approval || chain.stages.action.output_type === "approval_request") {
    assert.equal(chain.stages.action.applied, false, `${scenario.scenario_id} approval-required action must not be applied`);
  }
}

const waitingApproval = chainsById.get("waiting_approval");
assert.ok(waitingApproval, "waiting_approval chain missing");
assert.equal(waitingApproval.stages.approval.requires_approval, true);
assert.equal(waitingApproval.stages.action.output_type, "approval_request");
assert.equal(waitingApproval.stages.action.applied, false);

const runnerBlocked = chainsById.get("runner_blocked_open_loop");
assert.ok(runnerBlocked, "runner_blocked_open_loop chain missing");
assert.equal(runnerBlocked.stages.action.action_class, "commit_push_deploy");
assert.equal(runnerBlocked.stages.action.output_type, "approval_request");
assert.equal(runnerBlocked.stages.action.applied, false);

assert.ok(dashboard.approval_queue.length >= 2, "approval queue should expose approval-required loop outputs");
for (const request of dashboard.approval_queue) {
  assert.equal(request.owner, "Vincent");
  assert.ok(request.write_boundary.includes("Approval is required"));
}

verifyForbiddenRunnerCase();

console.log("MorroWise live dashboard loop verification OK");

function verifyForbiddenRunnerCase() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morrowise-live-loop-"));
  const policySource = path.join(root, "system-workflow", "registries", "morrowise-approval-policy.json");
  const policyTarget = path.join(tmpRoot, "system-workflow", "registries", "morrowise-approval-policy.json");
  fs.mkdirSync(path.dirname(policyTarget), { recursive: true });
  fs.copyFileSync(policySource, policyTarget);

  const runner = runMorrowiseActionRunner({
    candidates: [
      {
        recommendation_id: "verify.forbidden.secret-read",
        suggested_action: "read_secret_fixture",
        action_class: "read_or_output_secrets",
        suggested_task_id: "morrowise-live-dashboard-loop-verifier",
        risk_level: "high",
        requires_approval: true,
        evidence_refs: [{ type: "policy", ref: "$COLLAB/harness-mc/system-workflow/registries/morrowise-approval-policy.json" }],
        reason: "Fixture verifies forbidden actions stop before execution.",
      },
    ],
  }, { root: tmpRoot });

  const output = runner.outputs[0];
  assert.equal(runner.applied_actions, 0);
  assert.equal(output.policy, "forbidden");
  assert.equal(output.output_type, "approval_request");
  assert.equal(output.applied, false);
  assert.equal(output.approval_request.reason, "forbidden_action");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
