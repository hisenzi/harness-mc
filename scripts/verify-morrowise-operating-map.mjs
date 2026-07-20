#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mapPath = path.join(root, "milestones", "morrowise", "maps", "operating-loop.json");
const map = JSON.parse(fs.readFileSync(mapPath, "utf8"));
const expectedNodeIds = [
  "direction-governance",
  "source-memory",
  "sensing-events",
  "judgment-priority",
  "approval-safety",
  "action-delivery",
  "feedback-learning",
  "heartbeat-scheduling",
  "dashboard-surface",
  "knowledge-capture",
  "verification-immunity",
];
const allowedStatuses = new Set(["verified", "watch", "risk", "critical"]);

function findCollabDir(start) {
  let cursor = start;
  while (cursor !== path.dirname(cursor)) {
    if (fs.existsSync(path.join(cursor, "harness-mc")) && fs.existsSync(path.join(cursor, "notyet-harness"))) {
      return cursor;
    }
    cursor = path.dirname(cursor);
  }
  throw new Error("Unable to resolve $COLLAB from the current harness-mc checkout");
}

const collab = findCollabDir(root);

function sourcePath(reference) {
  const withoutAnchor = reference.split("#", 1)[0];
  if (withoutAnchor.startsWith("$COLLAB/harness-mc/")) {
    return path.join(root, withoutAnchor.slice("$COLLAB/harness-mc/".length));
  }
  if (withoutAnchor.startsWith("$COLLAB/notyet-harness/")) {
    return path.join(collab, "notyet-harness", withoutAnchor.slice("$COLLAB/notyet-harness/".length));
  }
  return null;
}

assert.equal(map.kind, "operating-loop");
assert.match(map.mermaid, /^flowchart TB/m);
assert.match(map.source_boundary, /不得反寫/);
assert.deepEqual(map.nodes.map((node) => node.id).sort(), [...expectedNodeIds].sort());

const nodeIds = new Set(map.nodes.map((node) => node.id));
for (const node of map.nodes) {
  assert.ok(allowedStatuses.has(node.status), `${node.id} has an invalid status`);
  assert.match(node.as_of, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(Array.isArray(node.evidence_refs) && node.evidence_refs.length > 0, `${node.id} needs evidence_refs`);
  assert.equal(typeof node.position?.x, "number");
  assert.equal(typeof node.position?.y, "number");
  for (const reference of node.evidence_refs) {
    const resolved = sourcePath(reference);
    assert.ok(resolved && fs.existsSync(resolved), `${node.id} evidence does not resolve: ${reference}`);
  }
}

assert.ok(map.relationships.some((relationship) => relationship.type === "guard"));
for (const relationship of map.relationships) {
  assert.ok(nodeIds.has(relationship.from), `unknown relationship source: ${relationship.from}`);
  assert.ok(nodeIds.has(relationship.to), `unknown relationship target: ${relationship.to}`);
}

console.log("MorroWise Operating Loop Map verification OK");
