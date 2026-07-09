// Verify the MorroWise API / CLI / MCP runtime status read model.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateCapabilityRuntimeStatus } from "./generate-capability-runtime-status.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outPath = path.join(root, ".tmp", "capability-runtime-status.verify.json");

const data = generateCapabilityRuntimeStatus({
  root,
  outPath,
  generatedAt: "2026-06-28T03:00:00.000Z",
  probes: {
    claudeMcpList: {
      ok: true,
      stdout: [
        "Checking MCP server health...",
        "",
        "notion-edu: https://mcp.notion.com/mcp (HTTP) - ! Needs authentication",
        "codex: /Applications/Codex.app/Contents/Resources/codex mcp-server - ✓ Connected",
        "heptabase-mcp: https://api.heptabase.com/mcp (HTTP) - ✓ Connected",
      ].join("\n"),
      exit_code: 0,
    },
    heptabaseWhiteboardList: {
      ok: true,
      stdout: JSON.stringify({ whiteboards: [{ id: "wb-1", name: "MorroWise" }], total: 305 }),
      exit_code: 0,
    },
    playwrightVersion: {
      ok: false,
      stdout: "",
      stderr: "zsh:1: command not found: playwright",
      exit_code: 127,
    },
    codexConfig: {
      ok: true,
      configured: true,
      source_ref: "$COLLAB/.codex/config.toml",
    },
    notionApiKey: {
      configured: true,
      source_ref: "$COLLAB/notyet-harness/000_Agent/config/secrets/notion.env",
    },
  },
});

assert.equal(data.schema_version, "capability-runtime-status.v0");
assert.equal(data.read_only, true);
assert.ok(fs.existsSync(outPath), "capability-runtime-status.json should be written");
assert.equal(data.task_anchor, "$COLLAB/harness-mc/milestones/morrowise/tasks.json#capability-runtime-status-read-model");

assert.deepEqual(Object.keys(data.source_layers).sort(), ["contract_verifier", "manual_evidence", "registry_snapshot", "runtime_probe"].sort());
assert.ok(data.write_boundary.forbidden.includes("read OAuth token content"));
assert.ok(data.write_boundary.forbidden.includes("read schedule/.env values"));
assert.ok(data.write_boundary.forbidden.includes("execute external writes"));

const requiredIds = [
  "registry.heptabase-cli-task-cards",
  "runtime.cc-heptabase-mcp",
  "runtime.codex-heptabase-mcp",
  "runtime.heptabase-local-cli",
  "runtime.playwright-cli",
  "runtime.notion-api-key",
  "runtime.notion-mcp-connector",
  "contract.notification-adapter",
  "legacy.heptabase-pai-mcp-oauth",
];
const statuses = new Map(data.items.map((item) => [item.id, item]));
for (const id of requiredIds) {
  assert.ok(statuses.has(id), `missing runtime status item: ${id}`);
}

for (const item of data.items) {
  assert.ok(["registry_snapshot", "runtime_probe", "contract_verifier", "manual_evidence"].includes(item.source_layer), `${item.id}: invalid source layer`);
  assert.ok(["ready", "legacy", "unknown", "blocked", "prototype", "not_applicable"].includes(item.registry_status), `${item.id}: invalid registry_status`);
  assert.ok(["connected", "configured", "missing", "needs_auth", "unknown", "not_applicable", "degraded"].includes(item.runtime_status), `${item.id}: invalid runtime_status`);
  assert.ok(["ready", "contract_ready", "not_verified", "not_applicable", "degraded"].includes(item.contract_status), `${item.id}: invalid contract_status`);
  assert.ok(["authenticated", "needs_auth", "not_required", "unknown"].includes(item.auth_status), `${item.id}: invalid auth_status`);
  assert.ok(item.next_action?.label, `${item.id}: next_action.label required`);
  assert.ok(Array.isArray(item.evidence_refs), `${item.id}: evidence_refs required`);
}

assert.equal(statuses.get("runtime.cc-heptabase-mcp").runtime_status, "connected");
assert.equal(statuses.get("runtime.cc-heptabase-mcp").auth_status, "authenticated");
assert.equal(statuses.get("runtime.notion-api-key").runtime_status, "configured");
assert.equal(statuses.get("runtime.notion-api-key").auth_status, "unknown");
assert.equal(statuses.get("runtime.notion-mcp-connector").runtime_status, "needs_auth");
assert.equal(statuses.get("runtime.notion-mcp-connector").auth_status, "needs_auth");
assert.equal(statuses.has("runtime.notion-mcp"), false, "legacy single Notion MCP status must be split");
assert.equal(statuses.get("runtime.heptabase-local-cli").runtime_status, "connected");
assert.equal(statuses.get("runtime.playwright-cli").registry_status, "legacy");
assert.equal(statuses.get("runtime.playwright-cli").runtime_status, "not_applicable");
assert.equal(statuses.get("contract.notification-adapter").contract_status, "contract_ready");
assert.equal(statuses.get("legacy.heptabase-pai-mcp-oauth").registry_status, "legacy");
assert.equal(statuses.get("legacy.heptabase-pai-mcp-oauth").runtime_status, "not_applicable");

assert.equal(data.summary.total, data.items.length);
assert.ok(data.summary.by_runtime_status.connected >= 2, "connected runtime count should be separated from registry ready");
assert.ok(data.summary.by_runtime_status.needs_auth >= 1, "needs_auth should be counted separately");
assert.ok(data.summary.by_registry_status.legacy >= 1, "legacy should be counted separately");
assert.ok(data.summary.by_contract_status.contract_ready >= 1, "contract_ready should be counted separately");
assert.ok(!data.next_actions.some((action) => action.target === "playwright-cli-capability-probe"), "Legacy Playwright must not route back to its completed probe task");
assert.ok(data.next_actions.some((action) => action.target === "notion-mcp-auth"), "Notion auth next action required");

const serialized = JSON.stringify(data);
for (const forbidden of ["access_token", "refresh_token", "client_secret", "NOTION_TOKEN", "TELEGRAM_BOT_TOKEN", "LINE_CHANNEL_ACCESS_TOKEN"]) {
  assert.ok(!serialized.includes(forbidden), `read model must not expose ${forbidden}`);
}

console.log("Capability runtime status verification OK");
