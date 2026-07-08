import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const registryPath = path.join(root, "system-workflow", "registries", "morrowise-dev-workflow-catalog.json");
const outPath = path.join(root, "public", "data", "morrowise-dev-workflows.json");

const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));

const byStatus = {};
const byPhase = {};
const nextActions = [];

for (const workflow of registry.workflows) {
  byStatus[workflow.status] = (byStatus[workflow.status] || 0) + 1;
  byPhase[workflow.phase] = (byPhase[workflow.phase] || 0) + 1;
  if (["adapter_only", "deferred", "prototype"].includes(workflow.status)) {
    nextActions.push({
      id: workflow.id,
      status: workflow.status,
      owner_task: workflow.owner_task,
      action: workflow.status === "adapter_only"
        ? "Keep as read-only route until an explicit external adapter approval policy exists."
        : workflow.status === "prototype"
          ? "Capture prototype answer into durable task/spec before implementation."
          : "Define a future owner task and safety boundary before routing.",
    });
  }
}

const readModel = {
  generated_at: new Date().toISOString(),
  source: "$COLLAB/harness-mc/system-workflow/registries/morrowise-dev-workflow-catalog.json",
  generator: "$COLLAB/harness-mc/scripts/generate-morrowise-dev-workflows.mjs",
  write_boundary: "read-only generated data; do not install skills, modify hooks, read secrets, or write external issue trackers from this surface",
  verifier_ref: "node scripts/verify-morrowise-dev-workflow-catalog.mjs",
  source_map_ref: registry.source_map_ref,
  detail_doc: registry.detail_doc,
  summary: {
    total: registry.workflows.length,
    by_status: byStatus,
    by_phase: byPhase,
    next_action_count: nextActions.length,
  },
  workflows: registry.workflows.map((workflow) => ({
    id: workflow.id,
    phase: workflow.phase,
    status: workflow.status,
    trigger: workflow.trigger,
    outputs: workflow.outputs,
    writes_to: workflow.writes_to,
    external_effect: workflow.external_effect,
    approval_policy: workflow.approval_policy,
    morrowise_stage: workflow.morrowise_stage,
    close_rule: workflow.close_rule,
    verifier_ref: workflow.verifier_ref,
    owner_task: workflow.owner_task,
    notes: workflow.notes,
  })),
  exclusions: registry.exclusions,
  next_actions: nextActions,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(readModel, null, 2)}\n`);
console.log(`Generated ${outPath} — ${registry.workflows.length} workflows`);
