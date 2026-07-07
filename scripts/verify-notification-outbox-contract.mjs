import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  appendNotification,
  buildNotification,
  planNotificationDelivery,
  validateNotification,
} from "./notification-outbox.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const contractPath = path.join(root, "system-workflow", "registries", "morrowise-notification-outbox-contract.json");
const notifierSpecPath = path.join(root, "system-workflow", "docs", "morrowise", "trusted-notifier.md");
const writerPath = path.join(root, "scripts", "notification-outbox.mjs");

const contract = readJson(contractPath);
const notifierSpec = fs.readFileSync(notifierSpecPath, "utf8");
const normalizedNotifierSpec = notifierSpec.replace(/[`$]/g, "");
const writerSource = fs.readFileSync(writerPath, "utf8");

assert.equal(contract.contract_id, "morrowise-notification-outbox-contract.v0");
assert.equal(contract.task_id, "notification-first-delivery");
assert.equal(contract.status, "contract_ready");
assert.equal(contract.outbox.path, "$COLLAB/notyet-harness/schedule/outbox/notifications.jsonl");
assert.equal(contract.notifier_state.storage, "$HOME/Library/Application Support/MorroWiseNotifier/delivered.sqlite");
assert.equal(contract.implementation_choice.id, "small-local-app-file-picker");
assert.equal(contract.implementation_choice.authorization, "Vincent selects exactly one outbox file via file picker");
assert.deepEqual(contract.entry_schema.allowed_fields, [
  "schema_version",
  "id",
  "level",
  "title",
  "body",
  "created_at",
  "ttl_seconds",
  "dedupe_key",
  "source",
  "task_anchor",
]);
assert.deepEqual(contract.entry_schema.levels, ["info", "watch", "amber", "red"]);
assert.equal(contract.entry_schema.max_title_chars, 80);
assert.equal(contract.entry_schema.max_body_chars, 240);
assert.equal(contract.entry_schema.default_ttl_seconds, 3600);
assert.ok(contract.entry_schema.forbidden_fields.includes("command"));
assert.ok(contract.entry_schema.forbidden_fields.includes("script_path"));
assert.ok(contract.entry_schema.forbidden_fields.includes("action_url"));
assert.ok(contract.writer_boundary.forbidden.includes("send notification"));
assert.ok(contract.writer_boundary.forbidden.includes("execute shell"));
assert.ok(contract.notifier_boundary.forbidden.includes("execute $COLLAB scripts"));
assert.ok(contract.notifier_boundary.forbidden.includes("write back to $COLLAB"));
assert.ok(contract.notifier_boundary.forbidden.includes("delete or mutate source files"));
assert.match(notifierSpec, /Chosen implementation/i);
assert.match(notifierSpec, /small local app/i);
assert.match(notifierSpec, /file picker/i);
assert.ok(contract.verification.checks.includes("unknown fields are rejected"));
assert.ok(contract.verification.checks.includes("expired notifications are skipped"));
assert.ok(contract.verification.checks.includes("overflow notifications are merged after rate limit"));
assert.ok(contract.verification.checks.includes("writer does not import child_process or call delivery tools"));
assert.ok(contract.verification.checks.includes("CLI can queue to a caller-provided outbox path without sending"));

for (const forbidden of [
  "runs shell",
  "runs node",
  "runs git",
  "writes back to COLLAB",
  "deletes files",
]) {
  assert.match(normalizedNotifierSpec, new RegExp(forbidden, "i"), `trusted notifier spec must say it never ${forbidden}`);
}

for (const forbidden of [
  "node:child_process",
  "child_process",
  "spawnSync",
  "execFile",
  "execSync",
  "osascript",
  "notify.sh",
  "launchctl",
]) {
  assert.equal(writerSource.includes(forbidden), false, `writer must not include delivery/execution primitive: ${forbidden}`);
}

const fixedNow = "2026-07-06T12:00:00.000Z";
const built = buildNotification({
  id: "pulse-proposals-red",
  level: "red",
  title: "MorroWise",
  body: "2 proposals need Vincent decision",
  source: "system-pulse",
  task_anchor: "$COLLAB/harness-mc/milestones/morrowise/tasks.json#notification-first-delivery",
  now: fixedNow,
});

assert.deepEqual(Object.keys(built).sort(), contract.entry_schema.allowed_fields.slice().sort());
assert.equal(built.schema_version, "notification.v0");
assert.equal(built.created_at, fixedNow);
assert.equal(built.ttl_seconds, 3600);
assert.equal(validateNotification(built).valid, true);

const withUnknownField = { ...built, command: "rm -rf $COLLAB" };
assert.equal(validateNotification(withUnknownField).valid, false);
assert.match(validateNotification(withUnknownField).errors.join("\n"), /unknown field|forbidden field/);

const badLevel = { ...built, level: "critical" };
assert.equal(validateNotification(badLevel).valid, false);
assert.match(validateNotification(badLevel).errors.join("\n"), /level/);

const tooLong = { ...built, body: "x".repeat(241) };
assert.equal(validateNotification(tooLong).valid, false);
assert.match(validateNotification(tooLong).errors.join("\n"), /body/);

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "notification-outbox-"));
try {
  const outboxPath = path.join(tmpRoot, "schedule", "outbox", "notifications.jsonl");
  appendNotification(built, { outboxPath });
  appendNotification({ ...built, id: "watch-1", level: "watch" }, { outboxPath });
  const lines = fs.readFileSync(outboxPath, "utf8").trim().split(/\r?\n/);
  assert.equal(lines.length, 2, "appendNotification must append JSONL lines");
  assert.equal(JSON.parse(lines[0]).id, "pulse-proposals-red");
  assert.equal(JSON.parse(lines[1]).id, "watch-1");

  const cliOutboxPath = path.join(tmpRoot, "cli", "notifications.jsonl");
  const cliResult = spawnSync(process.execPath, [
    writerPath,
    "--id",
    "cli-test",
    "--level",
    "amber",
    "--title",
    "MorroWise",
    "--body",
    "CLI queue test",
    "--source",
    "verifier",
    "--task-anchor",
    "$COLLAB/harness-mc/milestones/morrowise/tasks.json#notification-first-delivery",
  ], {
    encoding: "utf8",
    env: { ...process.env, MORROWISE_NOTIFICATION_OUTBOX: cliOutboxPath },
  });
  assert.equal(cliResult.status, 0, cliResult.stderr || cliResult.stdout);
  assert.match(cliResult.stdout, /notification queued: cli-test/);
  const cliLines = fs.readFileSync(cliOutboxPath, "utf8").trim().split(/\r?\n/);
  assert.equal(JSON.parse(cliLines.at(-1)).id, "cli-test");
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

const expired = {
  ...built,
  id: "expired",
  created_at: "2026-07-06T10:00:00.000Z",
  ttl_seconds: 60,
};
const planned = planNotificationDelivery(
  [
    built,
    expired,
    { ...built, id: "amber-1", level: "amber", created_at: "2026-07-06T12:00:01.000Z" },
    { ...built, id: "amber-2", level: "amber", created_at: "2026-07-06T12:00:02.000Z" },
  ],
  {
    now: "2026-07-06T12:00:30.000Z",
    deliveredIds: new Set(["already-delivered"]),
    maxPerMinute: 2,
  },
);
assert.equal(planned.deliveries.length, 2);
assert.equal(planned.skipped.some((item) => item.id === "expired" && item.reason === "expired"), true);
assert.equal(planned.deliveries.at(-1).id.startsWith("merged-"), true);
assert.match(planned.deliveries.at(-1).body, /2 notifications merged/);

console.log("Notification outbox contract verification OK");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
