import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const registryPath = path.join(root, "system-workflow", "registries", "morrowise-api-cli-mcp-capability-registry.json");
const outPath = path.join(root, "public", "data", "morrowise-capabilities.json");

const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));

const capabilities = registry.capabilities.map((capability) => {
  const latestHistory = capability.history.at(-1);
  return {
    id: capability.id,
    type: capability.type,
    provider: capability.provider,
    owner_task: capability.owner_task,
    scope: capability.scope,
    status: capability.status,
    entrypoint: capability.entrypoint,
    credential_governance: publicCredentialGovernance(capability.credential_governance),
    verifier: capability.verifier,
    next_action: capability.next_action,
    latest_history: latestHistory,
    history_count: capability.history.length,
  };
});

const byStatus = {};
const byType = {};
const blockers = [];
for (const capability of capabilities) {
  byStatus[capability.status] = (byStatus[capability.status] || 0) + 1;
  byType[capability.type] = (byType[capability.type] || 0) + 1;
  if (["blocked", "unknown"].includes(capability.status) || (capability.status === "legacy" && capability.next_action?.type !== "none")) {
    blockers.push({
      id: capability.id,
      status: capability.status,
      reason: capability.latest_history?.reason || "",
      next_action: capability.next_action,
    });
  }
}

const readModel = {
  generated_at: new Date().toISOString(),
  source: "$COLLAB/harness-mc/system-workflow/registries/morrowise-api-cli-mcp-capability-registry.json",
  generator: "$COLLAB/harness-mc/scripts/generate-morrowise-capabilities.mjs",
  stale_rule: "stale if registry.updated_at is older than latest capability history date or this file is not regenerated after registry changes",
  write_boundary: "read-only generated data; do not execute API / CLI / MCP capabilities from this surface",
  verifier_ref: "npm run test:capability-registry",
  credential_lifecycle: {
    schema_version: registry.credential_lifecycle_contract?.schema_version || "unknown",
    task_anchor: registry.credential_lifecycle_contract?.task_anchor || null,
    read_model: "$COLLAB/harness-mc/public/data/credential-health.json",
    value_boundary: "safe lifecycle metadata only; no credential values or local secure-store locations",
  },
  discovery: registry.discovery,
  summary: {
    total: capabilities.length,
    by_status: byStatus,
    by_type: byType,
    needs_attention: blockers.length,
  },
  capabilities,
  next_actions: blockers,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(readModel, null, 2)}\n`);
console.log(`Generated ${outPath} — ${capabilities.length} capabilities`);

function publicCredentialGovernance(governance) {
  if (!governance || governance.applicability === "not_applicable") {
    return { applicability: "not_applicable" };
  }
  return {
    applicability: "applicable",
    credential_class: governance.credential_class,
    incident_state: governance.incident_state,
    next_action: governance.next_action,
    last_verified_at: governance.last_verified_at,
  };
}
