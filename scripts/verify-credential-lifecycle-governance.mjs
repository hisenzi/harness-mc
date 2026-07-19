import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateCredentialHealth, validateMachineSummary } from "./generate-credential-health.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const registryPath = path.join(root, "system-workflow", "registries", "morrowise-api-cli-mcp-capability-registry.json");
const specPath = path.join(root, "system-workflow", "docs", "specs", "morrowise-credential-lifecycle.md");
const workflowPath = path.join(root, ".github", "workflows", "deploy.yml");
const pagePath = path.join(root, "app", "page.tsx");

const registry = readJson(registryPath);
const contract = registry.credential_lifecycle_contract;

assert.ok(fs.existsSync(specPath), "credential lifecycle spec is required");
assert.ok(contract && typeof contract === "object", "capability registry must contain credential_lifecycle_contract");
assert.equal(contract.schema_version, "credential-lifecycle.v0");
assert.deepEqual(contract.machine_ids, ["MBA-1", "MBA-2", "MBA-3"]);
assert.deepEqual(contract.credential_classes, [
  "service_static",
  "ci_federated",
  "human_account",
  "device_session",
  "recovery",
  "private_runtime",
]);
assert.deepEqual(contract.machine_summary_allowed_fields, [
  "schema_version",
  "machine_id",
  "posture",
  "connection_observed",
  "observed_at",
  "next_action",
  "sanitized_evidence_ref",
]);

for (const capability of registry.capabilities) {
  assert.ok(capability.credential_governance, `${capability.id} missing credential_governance`);
  assert.ok(["applicable", "not_applicable"].includes(capability.credential_governance.applicability), `${capability.id} invalid credential applicability`);
  if (capability.credential_governance.applicability === "applicable") {
    for (const field of [
      "credential_class",
      "owner_role",
      "consumer",
      "least_privilege_contract",
      "rotation_policy",
      "last_rotated_at",
      "rotation_due_at",
      "recovery_rule",
      "incident_state",
      "next_action",
      "sanitized_evidence_ref",
      "last_verified_at",
    ]) {
      assert.ok(Object.hasOwn(capability.credential_governance, field), `${capability.id} missing credential governance field ${field}`);
    }
  }
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "credential-health-"));
const summaryDir = path.join(tempRoot, "summaries");
const outPath = path.join(tempRoot, "credential-health.json");
fs.mkdirSync(summaryDir, { recursive: true });
writeJson(path.join(summaryDir, "MBA-1.json"), {
  schema_version: "credential-machine-summary.v0",
  machine_id: "MBA-1",
  posture: "configured",
  connection_observed: "observed",
  observed_at: "2026-07-19T00:00:00.000Z",
  next_action: "none",
  sanitized_evidence_ref: "local-secure-store-presence-check",
});
writeJson(path.join(summaryDir, "MBA-2.json"), {
  schema_version: "credential-machine-summary.v0",
  machine_id: "MBA-2",
  posture: "configured",
  connection_observed: "observed",
  observed_at: "2026-06-01T00:00:00.000Z",
  next_action: "refresh-sanitized-summary",
  sanitized_evidence_ref: "local-secure-store-presence-check",
});

const health = generateCredentialHealth({
  root,
  summaryDir,
  outPath,
  generatedAt: "2026-07-19T12:00:00.000Z",
  staleAfterDays: 7,
});

assert.equal(health.schema_version, "credential-health.v0");
assert.equal(health.read_only, true);
assert.equal(health.machines.length, 3);
assert.equal(health.machines.find((item) => item.machine_id === "MBA-1")?.freshness, "fresh");
assert.equal(health.machines.find((item) => item.machine_id === "MBA-2")?.freshness, "stale");
const mba3 = health.machines.find((item) => item.machine_id === "MBA-3");
assert.equal(mba3?.posture, "unknown");
assert.equal(mba3?.connection_observed, "missing_machine");
assert.equal(mba3?.observed_at, null);

assert.throws(
  () => validateMachineSummary({
    schema_version: "credential-machine-summary.v0",
    machine_id: "MBA-1",
    posture: "configured",
    connection_observed: "observed",
    observed_at: "2026-07-19T00:00:00.000Z",
    next_action: "none",
    sanitized_evidence_ref: "local-secure-store-presence-check",
    access_token: "must-not-pass",
  }),
  /forbidden field/i,
);

assert.throws(
  () => validateMachineSummary({
    schema_version: "credential-machine-summary.v0",
    machine_id: "MBA-1",
    posture: "configured",
    connection_observed: "observed",
    observed_at: "2026-07-19T00:00:00.000Z",
    next_action: "none",
    sanitized_evidence_ref: "/Users/private/credential-store",
  }),
  /unsafe value/i,
);

const serialized = JSON.stringify(health);
for (const forbidden of ["access_token", "refresh_token", "client_secret", "api_key", "cookie", "/Users/"]) {
  assert.ok(!serialized.includes(forbidden), `credential health read model must not expose ${forbidden}`);
}

const workflow = fs.readFileSync(workflowPath, "utf8");
assert.doesNotMatch(workflow, /pull_request_target/);
assert.doesNotMatch(workflow, /secrets\./);
assert.match(workflow, /persist-credentials:\s*false/);
assert.match(workflow, /^permissions:\n\s+contents:\s+read/m);
assert.match(workflow, /deploy:\n[\s\S]*?permissions:\n\s+pages:\s+write\n\s+id-token:\s+write/);

const page = fs.readFileSync(pagePath, "utf8");
assert.match(page, /credential-health\.json/);
assert.match(page, /CredentialHealthCard/);
assert.match(page, /missing_machine/);

console.log("Credential lifecycle governance verification OK");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
