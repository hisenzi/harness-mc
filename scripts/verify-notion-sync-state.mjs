import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateNotionSyncState } from "./generate-notion-sync-state.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outPath = path.join(root, ".tmp", "notion-sync-state.verify.json");

const data = generateNotionSyncState({
  root,
  outPath,
  generatedAt: "2026-07-03T09:00:00.000Z",
  notionApiKeyProbe: {
    configured: true,
    source_ref: "$COLLAB/notyet-harness/000_Agent/config/secrets/notion.env",
  },
  notionMcpProbe: {
    ok: true,
    stdout: "notion-edu: https://mcp.notion.com/mcp (HTTP) - ✓ Connected",
    exit_code: 0,
  },
});

assert.equal(data.schema_version, "notion-sync-state.v0");
assert.equal(data.read_only, true);
assert.ok(fs.existsSync(outPath), "notion sync read model should be written");
assert.equal(data.task_anchor, "$COLLAB/harness-mc/milestones/morrowise/tasks.json#notion-sync-read-model-v0");

assert.ok(data.generated_at, "generated_at required");
assert.ok(data.write_boundary.forbidden.includes("write Notion"));
assert.ok(data.write_boundary.forbidden.includes("read or print NOTION_TOKEN"));
assert.ok(data.write_boundary.forbidden.includes("rewrite tasks.json mirrors"));
assert.ok(data.verifier_ref === "npm run test:notion-sync-state");

assert.ok(data.runtime_routes, "runtime_routes required");
assert.equal(data.runtime_routes.notion_api_key.id, "runtime.notion-api-key");
assert.equal(data.runtime_routes.notion_api_key.runtime_status, "configured");
assert.equal(data.runtime_routes.notion_mcp_connector.id, "runtime.notion-mcp-connector");
assert.equal(data.runtime_routes.notion_mcp_connector.runtime_status, "connected");

assert.ok(Array.isArray(data.databases), "databases required");
assert.ok(data.databases.length >= 1, "at least one known Notion database required");

const kj = data.databases.find((database) => database.id === "kj-bilingual-action-db");
assert.ok(kj, "KJ bilingual Notion database must be tracked");
assert.equal(kj.source_of_truth, "Notion");
assert.equal(kj.mirror_path, "$COLLAB/harness-mc/milestones/kj-bilingual/tasks.json");
assert.equal(kj.notion_count, 43);
assert.equal(kj.mirror_count, 43);
assert.equal(kj.status, "connected");
assert.equal(kj.drift.length, 0);
assert.equal(kj.sync_direction, "Notion -> MC tasks.json -> Heptabase / PAI mirrors");
assert.equal(kj.last_sync, "2026-07-02T16:29:50.653Z");
assert.ok(kj.notion_db.database_id, "database_id required");
assert.ok(kj.notion_db.data_source_id, "data_source_id required");
assert.ok(kj.schema_property_count >= 10, "schema property count should come from snapshot metadata");
assert.ok(kj.sample_titles.includes("[B2] 確認轉換點＝115學年末（情境A）"));
assert.ok(kj.sample_titles.includes("[B3] 家長溝通方案＋通知信/說明會"));

const fixture = data.fixtures.find((item) => item.id === "kj-generation-drift-2026-07-01");
assert.ok(fixture, "known drift fixture required");
assert.equal(fixture.notion_count, 43);
assert.equal(fixture.mirror_count, 18);
assert.ok(fixture.drift.some((item) => item.type === "title_mismatch" && item.task_id === "B2"));
assert.ok(fixture.drift.some((item) => item.type === "notion_task_missing_in_mc_mirror" && item.task_id === "B3"));

assert.equal(data.summary.total, data.databases.length);
assert.equal(data.summary.connected, data.databases.filter((item) => item.status === "connected").length);
assert.equal(data.summary.drift, data.databases.filter((item) => item.status === "drift").length);
assert.equal(data.summary.disconnected, data.databases.filter((item) => item.status === "disconnected").length);
assert.ok(data.next_actions.some((action) => action.target === "mc-notion-sync-surface"));

const serialized = JSON.stringify(data);
for (const forbidden of ["secret_", "NOTION_TOKEN=", "access_token", "refresh_token", "client_secret"]) {
  assert.ok(!serialized.includes(forbidden), `read model must not expose ${forbidden}`);
}

console.log("Notion sync state verification OK");
