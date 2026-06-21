import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateMorrowiseLiveDashboard } from "./generate-morrowise-live-dashboard.mjs";

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
  "next_action",
  "write_boundary",
  "verifier_ref",
];

const expectedSurfaces = [
  "system_attention",
  "morrowise_living_system",
  "morrowise_proactive_loop",
  "task_event_pipeline",
  "worktree_status",
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
  "$COLLAB/harness-mc/sync-events/**/*.json",
  "$COLLAB/harness-mc/public/data/worktrees.json",
  "$COLLAB/harness-mc/system-workflow/registries/morrowise-approval-policy.json",
  "$COLLAB/harness-mc/public/data/morrowise-proactive-loop.json",
]) {
  assert.ok(sourceFiles.has(requiredSource), `missing source ${requiredSource}`);
}

assert.equal(data.completion_gate.worktree_commit.required_before_verification_result, true);
assert.ok(data.verification.verifier_ref.includes("test:morrowise-live-dashboard"));

console.log("MorroWise live dashboard data verification OK");
