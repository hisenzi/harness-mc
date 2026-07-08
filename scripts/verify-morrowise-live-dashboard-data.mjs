import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateSurfaceFreshness, generateMorrowiseLiveDashboard } from "./generate-morrowise-live-dashboard.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const data = generateMorrowiseLiveDashboard({ root });
const outPath = path.join(root, "public", "data", "morrowise-live-dashboard.json");

assert.equal(data.schema_version, "morrowise-live-dashboard.v0");
assert.equal(data.read_only, true);
assert.ok(fs.existsSync(outPath), "morrowise-live-dashboard.json should be written");

const requiredSurfaceFields = [
  "id",
  "label",
  "source_of_truth",
  "source_files",
  "generator",
  "generated_at",
  "stale_rule",
  "freshness_state",
  "last_updated_at",
  "freshness_reason",
  "next_action",
  "write_boundary",
  "verifier_ref",
];

const expectedSurfaces = [
  "system_attention",
  "morrowise_living_system",
  "morrowise_proactive_loop",
  "task_event_pipeline",
  "visual_sync_coverage",
  "worktree_status",
  "closeout_residual_ledger",
  "api_cli_mcp_capabilities",
  "notion_sync_state",
  "morrowise_dev_workflows",
  "schedule_runtime_health",
  "harness_governance",
  "approval_queue",
];

assert.deepEqual(data.surfaces.map((surface) => surface.id), expectedSurfaces);

for (const surface of data.surfaces) {
  for (const field of requiredSurfaceFields) {
    assert.ok(Object.hasOwn(surface, field), `${surface.id} missing ${field}`);
  }
  assert.ok(surface.source_files.length > 0, `${surface.id} should have source files`);
  assert.ok(surface.generator.length > 0, `${surface.id} should have generator`);
  assert.notEqual(surface.source_of_truth, "fixture", `${surface.id} must not use fixture source`);
}

const sourceFiles = new Set(data.surfaces.flatMap((surface) => surface.source_files));
for (const requiredSource of [
  "$COLLAB/harness-mc/public/data/projects.json",
  "$COLLAB/harness-mc/public/data/task-events.json",
  "$COLLAB/harness-mc/public/data/visual-sync-coverage.json",
  "$COLLAB/harness-mc/sync-events/**/*.json",
  "$COLLAB/harness-mc/public/data/worktrees.json",
  "$COLLAB/harness-mc/public/data/closeout-residual-ledger.json",
  "$COLLAB/harness-mc/system-workflow/registries/morrowise-api-cli-mcp-capability-registry.json",
  "$COLLAB/harness-mc/public/data/morrowise-capabilities.json",
  "$COLLAB/harness-mc/public/data/capability-runtime-status.json",
  "$COLLAB/harness-mc/system-workflow/registries/morrowise-notion-sync-state.json",
  "$COLLAB/harness-mc/public/data/notion-sync-state.json",
  "$COLLAB/harness-mc/system-workflow/registries/morrowise-dev-workflow-catalog.json",
  "$COLLAB/harness-mc/public/data/morrowise-dev-workflows.json",
  "$COLLAB/harness-mc/public/data/schedule-health.json",
  "$COLLAB/notyet-harness/schedule/tasks/*.yaml",
  "$COLLAB/harness-mc/system-workflow/registries/morrowise-approval-policy.json",
  "$COLLAB/harness-mc/public/data/morrowise-proactive-loop.json",
]) {
  assert.ok(sourceFiles.has(requiredSource), `missing source ${requiredSource}`);
}

assert.equal(data.completion_gate.worktree_commit.required_before_verification_result, true);
assert.ok(data.verification.verifier_ref.includes("test:morrowise-live-dashboard"));
assert.ok(Array.isArray(data.loop_chain), "loop_chain should be present");
assert.ok(data.routes.some((route) => route.id === "api_cli_mcp_capabilities.drilldown"), "capability drilldown route required");
assert.ok(data.routes.some((route) => route.id === "notion_sync_state.drilldown"), "Notion sync drilldown route required");
assert.ok(data.routes.some((route) => route.id === "morrowise_dev_workflows.drilldown"), "MorroWise dev workflow drilldown route required");
assert.ok(data.routes.some((route) => route.id === "schedule_runtime_health.drilldown"), "schedule runtime drilldown route required");
assert.ok(data.summary.source_counts.capability_runtime_items >= 0, "capability runtime source count should be present");
assert.ok(data.summary.source_counts.notion_sync_databases >= 0, "Notion sync source count should be present");

for (const surface of data.surfaces) {
  assert.ok(["fresh", "stale", "degraded", "unknown"].includes(surface.freshness_state), `${surface.id} has invalid freshness_state`);
  assert.ok(surface.freshness_reason, `${surface.id} should explain freshness`);
  assert.ok(surface.next_action?.label, `${surface.id} should expose next action`);
}

const degradedData = generateMorrowiseLiveDashboard({
  root: path.join(root, "__missing__"),
  write: false,
});

assert.equal(
  evaluateSurfaceFreshness({
    generated_at: "2026-06-21T00:00:00.000Z",
    stale_after_minutes: 15,
    missing_sources: [],
  }, new Date("2026-06-21T00:10:00.000Z")).state,
  "fresh",
);
assert.equal(
  evaluateSurfaceFreshness({
    generated_at: "2026-06-21T00:00:00.000Z",
    stale_after_minutes: 15,
    missing_sources: [],
  }, new Date("2026-06-21T00:16:00.000Z")).state,
  "stale",
);
assert.equal(
  evaluateSurfaceFreshness({
    generated_at: "2026-06-21T00:00:00.000Z",
    stale_after_minutes: 15,
    missing_sources: ["projects"],
  }, new Date("2026-06-21T00:01:00.000Z")).state,
  "degraded",
);
assert.equal(
  evaluateSurfaceFreshness({
    generated_at: null,
    stale_after_minutes: 15,
    missing_sources: [],
  }, new Date("2026-06-21T00:01:00.000Z")).state,
  "unknown",
);

assert.ok(degradedData.surfaces.every((surface) => ["degraded", "unknown"].includes(surface.freshness_state)), "missing source fixture should degrade or become unknown");
assert.ok(degradedData.surfaces.some((surface) => surface.freshness_state === "degraded"), "missing sources should produce at least one degraded surface");

console.log("MorroWise live dashboard data verification OK");
