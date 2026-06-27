import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const collabRoot = path.resolve(root, "..");

const contractPath = path.join(root, "system-workflow", "registries", "morrowise-notification-adapter-contract.json");
const capabilityRegistryPath = path.join(root, "system-workflow", "registries", "morrowise-api-cli-mcp-capability-registry.json");
const envExamplePath = path.join(collabRoot, "notyet-harness", "schedule", ".env.example");
const notifyPath = path.join(collabRoot, "notyet-harness", "schedule", "lib", "notify.sh");

const contract = readJson(contractPath);
const capabilityRegistry = readJson(capabilityRegistryPath);
const hasExternalScheduleFixture = fs.existsSync(envExamplePath) && fs.existsSync(notifyPath);
const envExample = hasExternalScheduleFixture ? fs.readFileSync(envExamplePath, "utf8") : "";

assert.equal(contract.contract_id, "morrowise-notification-adapter-contract.v0");
assert.equal(contract.task_id, "notification-adapter-contract");
assert.equal(contract.status, "contract_ready");
assert.equal(contract.read_only, true);
assert.ok(contract.write_boundary.forbidden.includes("read or print token values"));
assert.ok(contract.write_boundary.forbidden.includes("decide task state"));
assert.ok(contract.write_boundary.forbidden.includes("close Reality Tax Gate"));

const adapters = new Map(contract.adapters.map((adapter) => [adapter.id, adapter]));
for (const id of [
  "telegram_notify_sh",
  "line_messaging_api_push",
  "notion_optional_delivery",
  "codex_thread_manual_delivery",
]) {
  assert.ok(adapters.has(id), `missing adapter ${id}`);
}

const envNames = new Set(contract.env_contract.map((item) => item.name));
for (const name of [
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_ID",
  "LINE_CHANNEL_ACCESS_TOKEN",
  "LINE_TO_ID",
  "NOTION_DELIVERY_TOKEN",
  "NOTION_DELIVERY_TARGET",
  "CODEX_THREAD_DELIVERY_MODE",
]) {
  assert.ok(envNames.has(name), `contract missing env ${name}`);
  if (hasExternalScheduleFixture) {
    assert.match(envExample, new RegExp(`^${name}=`, "m"), `.env.example missing ${name}`);
  }
}

if (hasExternalScheduleFixture) {
  for (const line of envExample.split(/\r?\n/)) {
    if (!/^[A-Z0-9_]+=/.test(line)) continue;
    const [name, value = ""] = line.split("=", 2);
    if (name === "CODEX_THREAD_DELIVERY_MODE") continue;
    assert.equal(value, "", `${name} must not have a committed value`);
  }
}

const telegram = adapters.get("telegram_notify_sh");
assert.equal(telegram.entrypoint, "$COLLAB/notyet-harness/schedule/lib/notify.sh");
assert.equal(telegram.graceful_skip.missing_env_exit_code, 2);
assert.ok(telegram.forbidden.includes("mutate MC task state"));
if (hasExternalScheduleFixture) {
  assertNotifyGracefulSkip();
}

const line = adapters.get("line_messaging_api_push");
assert.equal(line.provider, "LINE Messaging API");
assert.equal(line.endpoint, "https://api.line.me/v2/bot/message/push");
assert.deepEqual(line.env, ["LINE_CHANNEL_ACCESS_TOKEN", "LINE_TO_ID"]);
assert.ok(line.legacy_forbidden.includes("LINE_NOTIFY_TOKEN"));
assert.ok(line.legacy_forbidden.includes("notify-bot.line.me API"));
assert.equal(line.degraded_without_env, true);
if (hasExternalScheduleFixture) {
  assert.ok(envExample.includes("LINE Notify 已於 2025-03-31 結束服務"));
}

const notion = adapters.get("notion_optional_delivery");
assert.equal(notion.status, "optional_not_implemented");
assert.equal(notion.entrypoint, null);
assert.equal(notion.degraded_without_env, true);

const thread = adapters.get("codex_thread_manual_delivery");
assert.equal(thread.status, "manual_handoff_only");
assert.equal(thread.entrypoint, null);

const capability = capabilityRegistry.capabilities.find((item) => item.id === "morrowise-notification-delivery-adapters");
assert.ok(capability, "capability registry must expose notification delivery adapters");
assert.equal(capability.owner_task, "notification-adapter-contract");
assert.equal(capability.status, "ready");
assert.ok(capability.verifier.includes("npm run test:notification-adapter-contract"));
assert.ok(capability.read_write_boundary.forbidden.includes("use LINE Notify"));
assert.ok(capability.history.some((event) => event.to_state === "ready" && /LINE uses Messaging API/.test(event.reason)));

if (hasExternalScheduleFixture) {
  console.log("MorroWise notification adapter contract verification OK");
} else {
  console.log("MorroWise notification adapter contract verification OK — external schedule fixture skipped");
}

function assertNotifyGracefulSkip() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "morrowise-notify."));
  try {
    const scheduleRoot = path.join(tmpRoot, "schedule");
    const libDir = path.join(scheduleRoot, "lib");
    fs.mkdirSync(libDir, { recursive: true });
    const fixtureNotify = path.join(libDir, "notify.sh");
    fs.copyFileSync(notifyPath, fixtureNotify);
    fs.chmodSync(fixtureNotify, 0o755);

    const result = spawnSync("bash", [fixtureNotify, "contract test"], {
      encoding: "utf8",
    });

    assert.equal(result.status, 2, "notify.sh should gracefully skip when .env is missing");
    assert.match(result.stderr, /略過推播|skip/i, "notify.sh should explain skipped delivery");
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
