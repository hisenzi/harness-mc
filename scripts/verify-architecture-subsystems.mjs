import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCollabRoot } from "./lib/collab-root.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const collabRoot = resolveCollabRoot(root);
const registryPath = path.join(root, "system-workflow", "registries", "morrowise-architecture-subsystems.json");
const tasksPath = path.join(root, "milestones", "morrowise", "tasks.json");
const architecturePath = path.join(collabRoot, "notyet-harness", "000_Agent", "ARCHITECTURE.md");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const registry = readJson(registryPath);
const morrowiseTasks = readJson(tasksPath).tasks || [];
const architectureDoc = fs.readFileSync(architecturePath, "utf8");

const STATUS = new Set(["active", "deprecated", "superseded", "deferred"]);
const DECISIONS = new Set(["promoted", "not_required", "deferred"]);
const REQUIRED_FIELDS = [
  "id",
  "name",
  "status",
  "role",
  "summary",
  "source_of_truth",
  "detail_doc",
  "task_anchor",
  "verifiers",
  "allowed_actions",
  "forbidden_actions",
  "safety_boundary",
  "degraded_state",
  "architecture_decision",
  "last_promoted_at",
  "last_verified_at",
];
const FORBIDDEN_REF_PATTERNS = [
  /\/Users\/[A-Za-z0-9._-]+\//,
  /secrets?\//i,
  /token/i,
  /cookie/i,
  /runtime[-_\s]?auth/i,
  /browser[-_\s]?cookies/i,
];

assert.equal(registry.registry_id, "morrowise-architecture-subsystems.v0");
assert.equal(registry.task_id, "architecture-subsystem-index-live-sync");
assert.equal(registry.status, "formal_registry");
assert.equal(registry.source_of_truth, "$COLLAB/harness-mc/system-workflow/registries/morrowise-architecture-subsystems.json");
assert.equal(registry.verifier_ref, "npm run test:architecture-subsystems");
assert.deepEqual(registry.decision_vocabulary, [...DECISIONS]);
assert.deepEqual(registry.status_vocabulary, [...STATUS]);
assert.deepEqual(registry.required_record_fields, REQUIRED_FIELDS);
assert.ok(Array.isArray(registry.records) && registry.records.length >= 1, "at least one architecture subsystem record is required");

const taskIds = new Set(morrowiseTasks.map((task) => task.id));
const seen = new Set();

for (const record of registry.records) {
  validateRecord(record);
  seen.add(record.id);
}

assert.equal(seen.size, registry.records.length, "architecture subsystem ids must be unique");

const notifier = registry.records.find((record) => record.id === "morrowise-trusted-notifier");
assert.ok(notifier, "Notifier fixture is required");
assert.equal(notifier.capability, "通知送達");
assert.equal(notifier.outbox, "$COLLAB/notyet-harness/schedule/outbox/notifications.jsonl");
assert.equal(notifier.trusted_app, "$COLLAB/harness-mc/tools/morrowise-notifier/MorroWiseNotifier.swift");
assert.equal(notifier.delivered_state, "$HOME/Library/Application Support/MorroWiseNotifier/delivered.sqlite");
assert.ok(notifier.verifiers.includes("npm run test:notification-outbox"));
assert.ok(notifier.verifiers.includes("npm run test:morrowise-notifier-source"));
assert.match(notifier.safety_boundary, /不包含廣域 Downloads/);
assert.match(notifier.degraded_state, /已排入佇列但未送達/);
assert.ok(notifier.forbidden_actions.some((item) => /回寫 \$COLLAB/.test(item)));

const block = architectureSubsystemBlock();
assert.match(block, /## 子系統索引（自動產生）|<!-- architecture-subsystems:start -->/);
assert.match(block, /自動產生，請勿手改/);
assert.match(block, /\| 子系統 \| 角色與摘要 \| 正本與細節 \| 邊界與狀態 \| 驗證與任務 \|/);
assert.match(block, /MorroWise 可信通知器/);
assert.match(block, /架構子系統索引同步/);
for (const forbiddenLabel of [
  "Auto-generated",
  "| Subsystem |",
  "Role + Summary",
  "Source / Detail",
  "Boundary + State",
  "Verifier / Task",
  "source:",
  "detail:",
  "allowed:",
  "forbidden:",
  "degraded:",
]) {
  assert.equal(block.includes(forbiddenLabel), false, `ARCHITECTURE subsystem block must stay zh-TW; found ${forbiddenLabel}`);
}
assert.match(block, new RegExp(`Registry 指紋：\`${registryFingerprint(registry)}\``), "ARCHITECTURE block fingerprint must match registry");

const supersededFixture = fixtureRecord({ status: "superseded", superseded_by: "replacement", superseded_reason: "" });
assert.throws(() => validateRecord(supersededFixture, { checkRefs: false }), /superseded_reason/);
const deprecatedFixture = fixtureRecord({ status: "deprecated", deprecated_reason: "" });
assert.throws(() => validateRecord(deprecatedFixture, { checkRefs: false }), /deprecated_reason/);

console.log("Architecture subsystem registry verification OK");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function validateRecord(record, { checkRefs = true } = {}) {
  for (const field of REQUIRED_FIELDS) {
    assert.ok(Object.hasOwn(record, field), `record ${record.id || "(missing id)"} missing ${field}`);
  }

  assert.equal(seen.has(record.id), false, `duplicate architecture subsystem id: ${record.id}`);
  assert.ok(STATUS.has(record.status), `${record.id} has invalid status`);
  assert.ok(DECISIONS.has(record.architecture_decision), `${record.id} has invalid architecture_decision`);
  assert.match(record.last_promoted_at, /^\d{4}-\d{2}-\d{2}$/, `${record.id} last_promoted_at must be YYYY-MM-DD`);
  assert.match(record.last_verified_at, /^\d{4}-\d{2}-\d{2}$/, `${record.id} last_verified_at must be YYYY-MM-DD`);
  assert.ok(Array.isArray(record.verifiers) && record.verifiers.length > 0, `${record.id} must list verifier commands`);
  assert.ok(Array.isArray(record.allowed_actions) && record.allowed_actions.length > 0, `${record.id} must list allowed_actions`);
  assert.ok(Array.isArray(record.forbidden_actions) && record.forbidden_actions.length > 0, `${record.id} must list forbidden_actions`);
  assert.equal(typeof record.safety_boundary, "string", `${record.id} safety_boundary must be text`);
  assert.equal(typeof record.degraded_state, "string", `${record.id} degraded_state must be text`);

  if (checkRefs) {
    for (const ref of refsFrom(record.source_of_truth, record.detail_doc, record.task_anchor)) {
      assertSafeRef(record.id, ref);
      assertResolvableRef(record.id, ref);
    }

    const taskId = String(record.task_anchor).split("#")[1] || "";
    assert.ok(taskIds.has(taskId), `${record.id} task_anchor task id must exist in morrowise tasks.json`);

    for (const command of record.verifiers) {
      assertVerifierCommand(record.id, command);
    }
  }

  if (record.architecture_decision === "promoted") {
    assert.ok(record.source_of_truth, `${record.id} promoted record needs source_of_truth`);
    assert.ok(record.detail_doc, `${record.id} promoted record needs detail_doc`);
    assert.ok(record.safety_boundary.length >= 40, `${record.id} promoted record needs concrete safety_boundary`);
    assert.ok(record.degraded_state.length >= 20, `${record.id} promoted record needs degraded_state`);
  }

  if (record.status === "superseded") {
    assert.ok(record.superseded_by, `${record.id} superseded record needs superseded_by`);
    assert.ok(record.superseded_reason, `${record.id} superseded record needs superseded_reason`);
  }
  if (record.status === "deprecated") {
    assert.ok(record.deprecated_reason, `${record.id} deprecated record needs deprecated_reason`);
  }
}

function refsFrom(...values) {
  return values.flatMap((value) => {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
  });
}

function assertSafeRef(recordId, ref) {
  for (const pattern of FORBIDDEN_REF_PATTERNS) {
    assert.equal(pattern.test(ref), false, `${recordId} contains forbidden source/auth ref: ${ref}`);
  }
}

function assertResolvableRef(recordId, ref) {
  if (ref.startsWith("$HOME/")) return;
  assert.match(ref, /^\$COLLAB\//, `${recordId} ref must use $COLLAB or $HOME: ${ref}`);
  const [fileRef] = ref.replace(/^\$COLLAB\//, "").split("#");
  const filePath = path.join(collabRoot, fileRef);
  assert.equal(fs.existsSync(filePath), true, `${recordId} ref does not resolve: ${ref}`);
}

function assertVerifierCommand(recordId, command) {
  if (command.startsWith("npm run ")) {
    const script = command.slice("npm run ".length).trim();
    assert.ok(packageJson.scripts?.[script], `${recordId} verifier npm script missing: ${script}`);
    return;
  }

  if (command.startsWith("node ")) {
    const script = command.slice("node ".length).split(/\s+/)[0];
    assert.equal(fs.existsSync(path.join(root, script)), true, `${recordId} node verifier missing: ${script}`);
    return;
  }

  if (command.startsWith("python3 ")) {
    const match = command.match(/"\$COLLAB\/([^"]+)"/) || command.match(/\$COLLAB\/(\S+)/);
    assert.ok(match, `${recordId} python verifier must reference a $COLLAB script: ${command}`);
    const script = match[1].split(/\s+/)[0];
    assert.equal(fs.existsSync(path.join(collabRoot, script)), true, `${recordId} python verifier missing: ${command}`);
    return;
  }

  throw new Error(`${recordId} unsupported verifier command: ${command}`);
}

function architectureSubsystemBlock() {
  const match = architectureDoc.match(/## 子系統索引（自動產生）[\s\S]*?<!-- architecture-subsystems:end -->/);
  assert.ok(match, "ARCHITECTURE.md must contain zh-TW architecture subsystem generated block");
  return match[0];
}

function registryFingerprint(value) {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex").slice(0, 16);
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function fixtureRecord(overrides = {}) {
  return {
    id: `fixture-${overrides.status || "active"}`,
    name: "Fixture",
    status: "active",
    role: "Fixture role",
    summary: "Fixture summary",
    source_of_truth: "$COLLAB/harness-mc/system-workflow/registries/morrowise-architecture-subsystems.json",
    detail_doc: "$COLLAB/notyet-harness/000_Agent/ARCHITECTURE.md",
    task_anchor: "$COLLAB/harness-mc/milestones/morrowise/tasks.json#architecture-subsystem-index-live-sync",
    verifiers: ["npm run test:architecture-subsystems"],
    allowed_actions: ["fixture allowed"],
    forbidden_actions: ["fixture forbidden"],
    safety_boundary: "Fixture safety boundary is intentionally long enough for promoted validation.",
    degraded_state: "Fixture degraded state is intentionally long enough.",
    architecture_decision: "promoted",
    last_promoted_at: "2026-07-07",
    last_verified_at: "2026-07-07",
    ...overrides,
  };
}
