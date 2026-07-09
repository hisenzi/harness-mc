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
    auth_boundary: capability.auth_boundary,
    secret_policy: capability.secret_policy,
    read_write_boundary: capability.read_write_boundary,
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
