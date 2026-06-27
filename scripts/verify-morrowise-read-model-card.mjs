import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const pagePath = path.join(root, "app", "page.tsx");
const liveDashboardPath = path.join(root, "public", "data", "morrowise-live-dashboard.json");

const page = fs.readFileSync(pagePath, "utf8");
const liveDashboard = JSON.parse(fs.readFileSync(liveDashboardPath, "utf8"));
const surface = liveDashboard.surfaces.find((item) => item.id === "morrowise_living_system");

assert.ok(surface, "morrowise_living_system surface must exist in live dashboard read model");

const functionStart = page.indexOf("function MorroWiseSurfaceCard");
const functionEnd = page.indexOf("function ReadModelField", functionStart);
assert.ok(functionStart >= 0 && functionEnd > functionStart, "MorroWiseSurfaceCard function block must be discoverable");

const cardBlock = page.slice(functionStart, functionEnd);

assert.match(cardBlock, /liveDashboard/, "MorroWiseSurfaceCard must receive liveDashboard data");
assert.match(cardBlock, /morrowise_living_system/, "MorroWiseSurfaceCard must select the morrowise_living_system surface");
assert.doesNotMatch(cardBlock, /changes\.json/, "MorroWiseSurfaceCard must not fetch changes.json directly");
assert.doesNotMatch(cardBlock, /task-events\.json/, "MorroWiseSurfaceCard must not fetch task-events.json directly");
assert.doesNotMatch(cardBlock, /projects\.find/, "MorroWiseSurfaceCard must not derive its own state from projects");

for (const field of [
  "source_of_truth",
  "source_files",
  "generator",
  "generated_at",
  "stale_rule",
  "freshness_state",
  "classification",
  "next_action",
  "write_boundary",
  "verifier_ref",
]) {
  assert.match(cardBlock, new RegExp(field), `MorroWiseSurfaceCard must render ${field}`);
}

assert.notEqual(surface.classification, "live", "fixture should not make semi-live MorroWise surface look fully live");
assert.equal(surface.classification, "semi_live", "morrowise_living_system should currently be semi_live");
assert.equal(surface.write_boundary.mode, "read_only", "morrowise_living_system surface must remain read-only");

console.log("MorroWise read-model card verification OK");
