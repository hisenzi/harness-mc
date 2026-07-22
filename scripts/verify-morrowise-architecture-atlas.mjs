import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const manifestPath = path.join(repoRoot, "system-workflow", "registries", "morrowise-architecture-atlas-manifest.json");

assert.ok(fs.existsSync(manifestPath), "Architecture Atlas link manifest must exist");

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
assert.equal(manifest.registry_id, "morrowise-architecture-atlas-manifest.v1");
assert.equal(manifest.kind, "link_manifest");
assert.equal(manifest.task_id, "project-topology-architecture-atlas");
assert.equal(manifest.source_of_truth, "$COLLAB/harness-mc/system-workflow/registries/morrowise-architecture-atlas-manifest.json");
assert.equal(manifest.verifier_ref, "npm run test:architecture-atlas");
assert.match(manifest.write_boundary.forbidden.join(" "), /second source of truth/i);
assert.ok(Array.isArray(manifest.records) && manifest.records.length >= 5, "Atlas needs the important architecture links");

const expectedIds = new Set([
  "agent-control-plane",
  "architecture-subsystem-catalog",
  "project-topology-registry",
  "document-source-registry",
  "repo-coordination-contract"
]);
const ids = new Set();
for (const record of manifest.records) {
  assert.match(record.id, /^[a-z0-9][a-z0-9-]*$/, `Atlas id must be kebab-case: ${record.id}`);
  assert.equal(ids.has(record.id), false, `duplicate Atlas id: ${record.id}`);
  ids.add(record.id);
  assert.ok(Array.isArray(record.source_refs) && record.source_refs.length > 0, `${record.id} requires source refs`);
  assert.ok(Array.isArray(record.detail_refs) && record.detail_refs.length > 0, `${record.id} requires detail refs`);
  assert.ok(Array.isArray(record.verifier_refs) && record.verifier_refs.length > 0, `${record.id} requires verifiers`);
  assert.match(record.task_anchor, /^\$COLLAB\/harness-mc\/milestones\/morrowise\/tasks\.json#[a-z0-9-]+$/, `${record.id} needs task anchor`);
  assert.ok(["task", "registry", "static"].includes(record.status_source.kind), `${record.id} needs a supported status source`);
  assert.ok(["task", "registry", "static"].includes(record.freshness_source.kind), `${record.id} needs a supported freshness source`);
}
for (const id of expectedIds) assert.ok(ids.has(id), `Atlas missing link: ${id}`);

console.log(`Architecture Atlas link manifest verification OK — ${manifest.records.length} links`);
