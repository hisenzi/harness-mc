import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const registryPath = path.join(root, "system-workflow", "registries", "morrowise-api-cli-mcp-capability-registry.json");
const agentsPath = path.join(root, "AGENTS.md");
const tasksPaths = [
  path.join(root, "milestones", "morrowise", "tasks.json"),
  path.join(root, "milestones", "dual-blade", "tasks.json"),
  path.join(root, "milestones", "harness-mc", "tasks.json"),
];

const registry = readJson(registryPath);
const taskIds = new Set();
for (const tasksPath of tasksPaths) {
  if (!fs.existsSync(tasksPath)) continue;
  for (const task of readJson(tasksPath).tasks || []) {
    taskIds.add(task.id);
  }
}

const capabilityStatuses = new Set(["ready", "blocked", "legacy", "prototype", "unknown"]);
const requiredFields = [
  "id",
  "type",
  "provider",
  "entrypoint",
  "owner_task",
  "scope",
  "source_of_truth",
  "auth_boundary",
  "read_write_boundary",
  "secret_policy",
  "credential_governance",
  "status",
  "verifier",
  "next_action",
  "history",
];
const requiredHistoryFields = [
  "date",
  "event_type",
  "from_state",
  "to_state",
  "reason",
  "evidence_ref",
  "actor_or_task",
  "next_action",
];
const credentialClasses = new Set([
  "service_static",
  "ci_federated",
  "human_account",
  "device_session",
  "recovery",
  "private_runtime",
]);
const credentialMetadataFields = [
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
];

assert.equal(registry.registry_id, "morrowise-api-cli-mcp-capability-registry.v0");
assert.equal(registry.task_id, "api-cli-mcp-capability-registry-v0");
assert.equal(registry.status, "formal_registry");
assert.ok(taskIds.has(registry.task_id), "registry task_id must exist");
assert.ok(registry.discovery && typeof registry.discovery === "object", "registry discovery block required");
assert.equal(registry.discovery.repo_agent_entry, "$COLLAB/harness-mc/AGENTS.md");
assert.equal(registry.discovery.test_command, "npm run test:capability-registry");
assert.match(registry.discovery.rule, /API \/ CLI \/ MCP/);
assert.deepEqual(registry.required_capability_fields, requiredFields);
assert.deepEqual(registry.required_history_fields, requiredHistoryFields);
assert.ok(Array.isArray(registry.capabilities) && registry.capabilities.length >= 3, "at least three fixture capabilities required");
validateCredentialLifecycleContract(registry.credential_lifecycle_contract);

const agentsDoc = fs.readFileSync(agentsPath, "utf8");
for (const phrase of [
  "API / CLI / MCP Capability Registry",
  "morrowise-api-cli-mcp-capability-registry.json",
  "api-cli-mcp-capability-registry-v0",
  "npm run test:capability-registry",
  "history",
]) {
  assert.ok(agentsDoc.includes(phrase), `AGENTS.md missing discoverability phrase: ${phrase}`);
}

const seen = new Set();
for (const capability of registry.capabilities) {
  validateRequiredFields(capability, requiredFields);
  assert.ok(!seen.has(capability.id), `duplicate capability id: ${capability.id}`);
  seen.add(capability.id);

  assert.ok(capabilityStatuses.has(capability.status), `${capability.id}: unknown status ${capability.status}`);
  assert.ok(taskIds.has(capability.owner_task), `${capability.id}: owner_task must exist in tracked MC tasks`);
  assertNonEmptyArray(capability.entrypoint, `${capability.id}: entrypoint required`);
  assertNonEmptyArray(capability.source_of_truth, `${capability.id}: source_of_truth required`);
  assertNonEmptyArray(capability.verifier, `${capability.id}: verifier required`);
  assertNonEmptyString(capability.auth_boundary, `${capability.id}: auth_boundary required`);
  assertNonEmptyString(capability.secret_policy, `${capability.id}: secret_policy required`);
  validateCredentialGovernance(capability);

  assert.ok(capability.read_write_boundary && typeof capability.read_write_boundary === "object", `${capability.id}: read_write_boundary object required`);
  assertNonEmptyArray(capability.read_write_boundary.read, `${capability.id}: read boundary required`);
  assert.ok(Array.isArray(capability.read_write_boundary.write), `${capability.id}: write boundary must be an array`);
  assertNonEmptyArray(capability.read_write_boundary.forbidden, `${capability.id}: forbidden boundary required`);

  assert.ok(capability.next_action && typeof capability.next_action === "object", `${capability.id}: next_action object required`);
  assertNonEmptyString(capability.next_action.type, `${capability.id}: next_action.type required`);
  assertNonEmptyString(capability.next_action.task_id, `${capability.id}: next_action.task_id required`);
  assert.ok(taskIds.has(capability.next_action.task_id), `${capability.id}: next_action.task_id must exist in tracked MC tasks`);
  assertNonEmptyString(capability.next_action.description, `${capability.id}: next_action.description required`);

  assertNonEmptyArray(capability.history, `${capability.id}: history required`);
  for (const event of capability.history) {
    validateRequiredFields(event, requiredHistoryFields, `${capability.id} history`);
    assert.match(event.date, /^\d{4}-\d{2}-\d{2}$/, `${capability.id}: history date must be YYYY-MM-DD`);
    for (const field of requiredHistoryFields) {
      assertNonEmptyString(event[field], `${capability.id}: history.${field} required`);
    }
  }

  if (capability.status === "legacy") {
    assert.ok(
      capability.history.some((event) => /legacy|fallback|archive/i.test(`${event.to_state} ${event.reason} ${event.next_action}`)),
      `${capability.id}: legacy capability requires legacy/fallback/archive history`,
    );
  }

  if (capability.status === "ready") {
    assert.ok(
      capability.history.some((event) => /confirmed|ready|mainline/i.test(`${event.event_type} ${event.to_state} ${event.reason}`)),
      `${capability.id}: ready capability requires confirming history`,
    );
  }
}

const heptabaseCli = registry.capabilities.find((capability) => capability.id === "heptabase-cli-task-cards");
assert.ok(heptabaseCli, "Heptabase CLI fixture required");
assert.equal(heptabaseCli.status, "ready");
assert.ok(heptabaseCli.history.some((event) => event.to_state === "cli_mainline"), "Heptabase CLI must record CLI mainline transition");

const heptabaseLegacy = registry.capabilities.find((capability) => capability.id === "heptabase-pai-legacy-mcp-oauth");
assert.ok(heptabaseLegacy, "legacy MCP/OAuth fixture required");
assert.equal(heptabaseLegacy.status, "legacy");
assert.equal(heptabaseLegacy.next_action.task_id, "heptabase-pai-legacy-archive");

const playwright = registry.capabilities.find((capability) => capability.id === "playwright-cli");
assert.ok(playwright, "Playwright CLI fixture required");
assert.equal(playwright.status, "legacy");
assert.equal(playwright.owner_task, "playwright-cli-capability-probe");
assert.equal(playwright.next_action.type, "none");
assert.equal(playwright.next_action.task_id, "api-cli-mcp-capability-registry-v0");
assert.ok(playwright.history.some((event) => event.event_type === "install_reported"), "Playwright must record install report");
assert.ok(playwright.history.some((event) => event.event_type === "local_probe"), "Playwright must record local probe result");
assert.ok(
  playwright.history.some((event) => event.date === "2026-06-27" && /no PATH command/.test(event.reason)),
  "Playwright must record the latest unresolved local probe",
);
assert.ok(
  playwright.history.some((event) => event.date === "2026-07-09" && event.to_state === "legacy" && /Codex browser\/chrome tools/.test(event.reason)),
  "Playwright must record the legacy ownership resolution",
);

const notificationAdapter = registry.capabilities.find((capability) => capability.id === "morrowise-notification-delivery-adapters");
assert.equal(notificationAdapter?.credential_governance?.credential_class, "service_static");
const accountConnectors = registry.capabilities.find((capability) => capability.id === "claude-ai-account-connectors-policy");
assert.equal(accountConnectors?.credential_governance?.credential_class, "human_account");

console.log("MorroWise API / CLI / MCP capability registry verification OK");

function validateRequiredFields(value, fields, label = value.id || "object") {
  for (const field of fields) {
    assert.ok(Object.hasOwn(value, field), `${label} missing ${field}`);
  }
}

function assertNonEmptyArray(value, message) {
  assert.ok(Array.isArray(value), message);
  assert.ok(value.length > 0, message);
}

function assertNonEmptyString(value, message) {
  assert.equal(typeof value, "string", message);
  assert.ok(value.trim().length > 0, message);
}

function validateCredentialLifecycleContract(contract) {
  assert.ok(contract && typeof contract === "object", "credential lifecycle contract required");
  assert.equal(contract.schema_version, "credential-lifecycle.v0");
  assert.deepEqual(contract.machine_ids, ["MBA-1", "MBA-2", "MBA-3"]);
  assert.deepEqual([...contract.credential_classes].sort(), [...credentialClasses].sort());
  assert.deepEqual(contract.metadata_allowed_fields, credentialMetadataFields);
  assert.deepEqual(contract.machine_summary_allowed_fields, [
    "schema_version",
    "machine_id",
    "posture",
    "connection_observed",
    "observed_at",
    "next_action",
    "sanitized_evidence_ref",
  ]);
  assertNonEmptyString(contract.task_anchor, "credential lifecycle contract task_anchor required");
  assertNonEmptyString(contract.spec_ref, "credential lifecycle contract spec_ref required");
  assertNonEmptyString(contract.value_boundary, "credential lifecycle contract value_boundary required");
  assertNonEmptyString(contract.github_actions_baseline, "credential lifecycle contract github_actions_baseline required");
}

function validateCredentialGovernance(capability) {
  const governance = capability.credential_governance;
  assert.ok(governance && typeof governance === "object", `${capability.id}: credential_governance object required`);
  assert.ok(["applicable", "not_applicable"].includes(governance.applicability), `${capability.id}: credential applicability is invalid`);
  if (governance.applicability === "not_applicable") {
    assertNonEmptyString(governance.reason, `${capability.id}: non-applicable reason required`);
    return;
  }
  for (const field of credentialMetadataFields) {
    assert.ok(Object.hasOwn(governance, field), `${capability.id}: credential governance missing ${field}`);
  }
  assert.ok(credentialClasses.has(governance.credential_class), `${capability.id}: invalid credential class`);
  for (const field of [
    "owner_role",
    "consumer",
    "least_privilege_contract",
    "rotation_policy",
    "recovery_rule",
    "incident_state",
    "next_action",
    "sanitized_evidence_ref",
    "last_verified_at",
  ]) {
    assertNonEmptyString(governance[field], `${capability.id}: credential governance ${field} required`);
  }
  for (const field of ["last_rotated_at", "rotation_due_at"]) {
    assert.ok(governance[field] === null || /^\d{4}-\d{2}-\d{2}$/.test(governance[field]), `${capability.id}: ${field} must be null or YYYY-MM-DD`);
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
