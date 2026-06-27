import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const manifestPath = path.join(root, "system-workflow", "registries", "morrowise-wiring-gate.json");

assert.ok(fs.existsSync(manifestPath), "MorroWise wiring gate manifest required");

const manifest = readJson(manifestPath);
const morrowiseTasks = readJson(path.join(root, "milestones", "morrowise", "tasks.json")).tasks || [];
const liveDashboard = readJson(path.join(root, "public", "data", "morrowise-live-dashboard.json"));
const homepage = fs.readFileSync(path.join(root, "app", "page.tsx"), "utf8");
const agents = fs.readFileSync(path.join(root, "AGENTS.md"), "utf8");
const packageJson = readJson(path.join(root, "package.json"));

const requiredWiringFields = [
  "id",
  "label",
  "owner_task",
  "source_registry",
  "generated_read_model",
  "read_model_generator",
  "live_dashboard_surface_id",
  "homepage_anchor",
  "verifier_refs",
  "routing_refs",
  "next_action_task",
  "fixture_scope",
];

const baseContext = {
  root,
  taskIds: new Set(morrowiseTasks.map((task) => task.id)),
  liveDashboard,
  homepage,
  agents,
  packageJson,
};

verifyWiringGate(manifest, baseContext);
verifyNegativeFixtures(manifest, baseContext);

console.log("MorroWise wiring gate verification OK");

function verifyWiringGate(manifest, context) {
  const { taskIds, liveDashboard, homepage, agents, packageJson } = context;

  assert.equal(manifest.registry_id, "morrowise-wiring-gate.v0");
  assert.equal(manifest.task_id, "morrowise-wiring-gate-verifier");
  assert.equal(manifest.status, "formal_gate");
  assert.ok(taskIds.has(manifest.task_id), "wiring gate task_id must exist in morrowise tasks");
  assert.deepEqual(manifest.required_wiring_fields, requiredWiringFields);
  assert.ok(manifest.negative_fixture_policy, "negative fixture policy required");
  assert.deepEqual(manifest.negative_fixture_policy.covered_missing_layers, [
    "generated_read_model",
    "live_dashboard_surface",
    "homepage_anchor",
    "AGENTS_routing",
    "verifier_script",
  ]);
  assert.ok(Array.isArray(manifest.fixtures) && manifest.fixtures.length > 0, "at least one wiring fixture required");

  for (const fixture of manifest.fixtures) {
    for (const field of requiredWiringFields) {
      assert.ok(Object.hasOwn(fixture, field), `${fixture.id || "fixture"} missing ${field}`);
    }

    assert.ok(taskIds.has(fixture.owner_task), `${fixture.id}: owner_task must exist`);
    assert.ok(taskIds.has(fixture.next_action_task), `${fixture.id}: next_action_task must exist`);
    assert.notEqual(fixture.fixture_scope, "system_complete", `${fixture.id}: fixture cannot claim system_complete`);

    const sourceRegistryPath = resolveCollabPath(fixture.source_registry);
    const readModelPath = resolveCollabPath(fixture.generated_read_model);
    const generatorPath = resolveCollabPath(fixture.read_model_generator);
    assert.ok(fs.existsSync(sourceRegistryPath), `${fixture.id}: source registry missing`);
    assert.ok(fs.existsSync(readModelPath), `${fixture.id}: generated read model missing`);
    assert.ok(fs.existsSync(generatorPath), `${fixture.id}: read model generator missing`);

    const sourceRegistry = readJson(sourceRegistryPath);
    const readModel = readJson(readModelPath);
    assert.equal(readModel.source, fixture.source_registry, `${fixture.id}: read model source must point to source registry`);
    assert.equal(readModel.generator, fixture.read_model_generator, `${fixture.id}: read model generator must point to generator`);
    assert.ok(readModel.generated_at, `${fixture.id}: read model generated_at required`);
    assert.ok(readModel.write_boundary, `${fixture.id}: read model write_boundary required`);
    assert.ok(readModel.verifier_ref, `${fixture.id}: read model verifier_ref required`);
    assert.ok(readModel.next_actions, `${fixture.id}: read model next_actions required`);

    assert.equal(sourceRegistry.task_id, fixture.owner_task, `${fixture.id}: source registry task_id must match owner_task`);
    assert.ok(sourceRegistry.discovery, `${fixture.id}: source registry discovery block required`);

    const surface = liveDashboard.surfaces.find((item) => item.id === fixture.live_dashboard_surface_id);
    assert.ok(surface, `${fixture.id}: live dashboard surface missing`);
    assert.ok(surface.source_files.includes(fixture.source_registry), `${fixture.id}: dashboard surface missing source registry`);
    assert.ok(surface.source_files.includes(fixture.generated_read_model), `${fixture.id}: dashboard surface missing read model`);
    assert.equal(surface.verifier_ref, "npm run test:capability-registry", `${fixture.id}: dashboard verifier_ref mismatch`);
    assert.equal(surface.next_action?.target, fixture.next_action_task, `${fixture.id}: dashboard next_action must route to next_action_task`);

    assert.ok(homepage.includes(`id="${fixture.homepage_anchor}"`), `${fixture.id}: homepage anchor missing`);
    assert.ok(homepage.includes(`${fixture.live_dashboard_surface_id}: "#${fixture.homepage_anchor}"`), `${fixture.id}: sidebar anchor mapping missing`);

    for (const verifierRef of fixture.verifier_refs) {
      assert.ok(verifierCommandExists(verifierRef, packageJson), `${fixture.id}: missing verifier script ${verifierRef}`);
    }

    for (const routingRef of fixture.routing_refs) {
      if (routingRef.endsWith("AGENTS.md")) {
        assert.ok(agents.includes(path.basename(routingRef)), `${fixture.id}: AGENTS routing self-reference missing`);
        assert.ok(agents.includes("registry -> generated read model -> MorroWise live dashboard surface -> homepage card -> verifier"), `${fixture.id}: AGENTS wiring chain missing`);
      }
    }
  }
}

function verifyNegativeFixtures(manifest, context) {
  assertVerificationFails(
    () => verifyWiringGate(withFirstFixture(manifest, { generated_read_model: "$COLLAB/harness-mc/public/data/missing-read-model.json" }), context),
    /generated read model missing/,
    "missing generated read model must fail",
  );

  assertVerificationFails(
    () => verifyWiringGate(manifest, { ...context, liveDashboard: { ...context.liveDashboard, surfaces: [] } }),
    /live dashboard surface missing/,
    "missing live dashboard surface must fail",
  );

  assertVerificationFails(
    () => verifyWiringGate(manifest, { ...context, homepage: context.homepage.replace('id="api-cli-mcp-capabilities"', 'id="removed-api-cli-mcp-capabilities"') }),
    /homepage anchor missing/,
    "missing homepage anchor must fail",
  );

  assertVerificationFails(
    () => verifyWiringGate(manifest, { ...context, agents: context.agents.replace("registry -> generated read model -> MorroWise live dashboard surface -> homepage card -> verifier", "registry -> generated read model") }),
    /AGENTS wiring chain missing/,
    "missing AGENTS wiring route must fail",
  );

  const packageWithoutVerifier = structuredClone(context.packageJson);
  delete packageWithoutVerifier.scripts["test:capability-registry"];
  assertVerificationFails(
    () => verifyWiringGate(manifest, { ...context, packageJson: packageWithoutVerifier }),
    /missing verifier script/,
    "missing npm verifier script must fail",
  );
}

function assertVerificationFails(fn, expectedMessage, label) {
  assert.throws(fn, expectedMessage, label);
}

function withFirstFixture(manifest, patch) {
  const copy = structuredClone(manifest);
  copy.fixtures[0] = { ...copy.fixtures[0], ...patch };
  return copy;
}

function verifierCommandExists(command, packageJson) {
  if (!command.startsWith("npm run ")) return true;
  const scriptName = command.slice("npm run ".length);
  return Boolean(packageJson.scripts?.[scriptName]);
}

function resolveCollabPath(value) {
  return value.replace("$COLLAB/harness-mc", root);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
