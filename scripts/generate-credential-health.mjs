import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(__dirname, "..");
const MACHINE_IDS = ["MBA-1", "MBA-2", "MBA-3"];
const POSTURES = new Set(["configured", "degraded", "unknown", "not_applicable"]);
const CONNECTION_STATES = new Set(["observed", "not_observed", "unknown", "not_applicable"]);
const ALLOWED_FIELDS = [
  "schema_version",
  "machine_id",
  "posture",
  "connection_observed",
  "observed_at",
  "next_action",
  "sanitized_evidence_ref",
];
const UNSAFE_VALUE = /(?:\/Users\/|~\/|\b(?:access[_-]?token|refresh[_-]?token|client[_-]?secret|api[_-]?key|password|cookie|private[_-]?key)\b|\b(?:gh[opsu]_|sk-|Bearer\s))/i;

export function generateCredentialHealth(options = {}) {
  const root = options.root || defaultRoot;
  const summaryDir = options.summaryDir || path.join(root, ".tmp", "credential-health");
  const outPath = options.outPath || path.join(root, "public", "data", "credential-health.json");
  const generatedAt = options.generatedAt || new Date().toISOString();
  const staleAfterDays = options.staleAfterDays ?? 7;
  const registry = options.registry || readJson(path.join(root, "system-workflow", "registries", "morrowise-api-cli-mcp-capability-registry.json"));

  const machines = MACHINE_IDS.map((machineId) => {
    const summary = readSummary(summaryDir, machineId);
    return summary
      ? normalizeSummary(summary, { generatedAt, staleAfterDays })
      : missingMachine(machineId);
  });

  const data = {
    schema_version: "credential-health.v0",
    generated_at: generatedAt,
    read_only: true,
    task_anchor: "$COLLAB/harness-mc/milestones/morrowise/tasks.json#credential-lifecycle-governance",
    source: {
      credential_contract: "$COLLAB/harness-mc/system-workflow/registries/morrowise-api-cli-mcp-capability-registry.json#credential_lifecycle_contract",
      machine_summary: "trusted local sanitized machine summary only",
    },
    generator: "$COLLAB/harness-mc/scripts/generate-credential-health.mjs",
    stale_rule: `machine summary is stale after ${staleAfterDays} days; absent summary is missing_machine and never healthy`,
    write_boundary: {
      allowed: [
        "read validated sanitized machine summary JSON",
        "read capability credential governance metadata",
        "write generated credential-health read model",
      ],
      forbidden: [
        "read credential values",
        "read managed vault paths or secret names",
        "read browser session state or runtime authentication",
        "read private local settings",
        "execute credential rotation, revocation, login, or external writes",
      ],
    },
    machines,
    capability_contracts: (registry.capabilities || [])
      .filter((capability) => capability.credential_governance?.applicability === "applicable")
      .map((capability) => ({
        capability_id: capability.id,
        credential_class: capability.credential_governance.credential_class,
        owner_role: capability.credential_governance.owner_role,
        consumer: capability.credential_governance.consumer,
        rotation_policy: capability.credential_governance.rotation_policy,
        last_rotated_at: capability.credential_governance.last_rotated_at,
        rotation_due_at: capability.credential_governance.rotation_due_at,
        incident_state: capability.credential_governance.incident_state,
        next_action: capability.credential_governance.next_action,
        last_verified_at: capability.credential_governance.last_verified_at,
        sanitized_evidence_ref: capability.credential_governance.sanitized_evidence_ref,
      })),
    summary: summarize(machines),
  };

  assertNoUnsafeOutput(data);
  if (options.write !== false) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(data, null, 2)}\n`);
    console.log(`Generated ${outPath} — ${data.machines.length} machine summaries, ${data.summary.missing_machine} missing`);
  }
  return data;
}

export function validateMachineSummary(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("credential machine summary must be an object");
  }
  for (const key of Object.keys(value)) {
    if (!ALLOWED_FIELDS.includes(key)) throw new Error(`forbidden field in credential machine summary: ${key}`);
  }
  for (const key of ALLOWED_FIELDS) {
    if (!Object.hasOwn(value, key)) throw new Error(`credential machine summary missing ${key}`);
  }
  if (value.schema_version !== "credential-machine-summary.v0") throw new Error("credential machine summary schema_version is invalid");
  if (!MACHINE_IDS.includes(value.machine_id)) throw new Error("credential machine summary machine_id is invalid");
  if (!POSTURES.has(value.posture)) throw new Error("credential machine summary posture is invalid");
  if (!CONNECTION_STATES.has(value.connection_observed)) throw new Error("credential machine summary connection_observed is invalid");
  if (typeof value.observed_at !== "string" || Number.isNaN(Date.parse(value.observed_at))) {
    throw new Error("credential machine summary observed_at is invalid");
  }
  for (const key of ["next_action", "sanitized_evidence_ref"]) {
    if (typeof value[key] !== "string" || value[key].trim() === "") throw new Error(`credential machine summary ${key} is required`);
    if (UNSAFE_VALUE.test(value[key])) throw new Error(`unsafe value in credential machine summary: ${key}`);
  }
  return value;
}

function readSummary(summaryDir, machineId) {
  const filePath = path.join(summaryDir, `${machineId}.json`);
  if (!fs.existsSync(filePath)) return null;
  return validateMachineSummary(readJson(filePath));
}

function normalizeSummary(summary, { generatedAt, staleAfterDays }) {
  const ageMs = new Date(generatedAt).getTime() - new Date(summary.observed_at).getTime();
  const stale = ageMs > staleAfterDays * 24 * 60 * 60 * 1000;
  return {
    machine_id: summary.machine_id,
    posture: summary.posture,
    connection_observed: summary.connection_observed,
    observed_at: summary.observed_at,
    freshness: stale ? "stale" : "fresh",
    next_action: stale ? "refresh-sanitized-summary" : summary.next_action,
    sanitized_evidence_ref: summary.sanitized_evidence_ref,
  };
}

function missingMachine(machineId) {
  return {
    machine_id: machineId,
    posture: "unknown",
    connection_observed: "missing_machine",
    observed_at: null,
    freshness: "missing_machine",
    next_action: "collect-sanitized-summary-with-vincent-approval",
    sanitized_evidence_ref: "none",
  };
}

function summarize(machines) {
  const summary = { total: machines.length, fresh: 0, stale: 0, missing_machine: 0, unknown: 0 };
  for (const machine of machines) {
    if (machine.freshness === "fresh") summary.fresh += 1;
    else if (machine.freshness === "stale") summary.stale += 1;
    else if (machine.freshness === "missing_machine") summary.missing_machine += 1;
    else summary.unknown += 1;
  }
  return summary;
}

function assertNoUnsafeOutput(value) {
  const serialized = JSON.stringify(value);
  if (UNSAFE_VALUE.test(serialized)) throw new Error("credential health read model contains unsafe value");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--summary-dir") options.summaryDir = argv[++index];
    if (arg === "--out") options.outPath = argv[++index];
  }
  return options;
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isCli) generateCredentialHealth(parseArgs(process.argv.slice(2)));
