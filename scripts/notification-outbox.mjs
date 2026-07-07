import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const collabRoot = path.resolve(repoRoot, "..");

export const NOTIFICATION_SCHEMA_VERSION = "notification.v0";
export const ALLOWED_FIELDS = [
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
];
export const FORBIDDEN_FIELDS = [
  "command",
  "script",
  "script_path",
  "shell",
  "args",
  "action",
  "action_url",
  "callback",
  "delete_path",
  "write_path",
];
export const LEVELS = ["info", "watch", "amber", "red"];
export const DEFAULT_TTL_SECONDS = 3600;
export const DEFAULT_OUTBOX_PATH = path.join(collabRoot, "notyet-harness", "schedule", "outbox", "notifications.jsonl");

export function buildNotification(input) {
  const createdAt = input.now || input.created_at || new Date().toISOString();
  const notification = {
    schema_version: NOTIFICATION_SCHEMA_VERSION,
    id: input.id || buildNotificationId(input, createdAt),
    level: input.level,
    title: input.title,
    body: input.body,
    created_at: createdAt,
    ttl_seconds: input.ttl_seconds ?? DEFAULT_TTL_SECONDS,
    dedupe_key: input.dedupe_key || input.id || buildNotificationId(input, createdAt),
    source: input.source || "morrowise",
    task_anchor: input.task_anchor || "",
  };

  const result = validateNotification(notification);
  if (!result.valid) {
    throw new Error(`invalid notification: ${result.errors.join("; ")}`);
  }
  return notification;
}

export function appendNotification(notification, options = {}) {
  const result = validateNotification(notification);
  if (!result.valid) {
    throw new Error(`invalid notification: ${result.errors.join("; ")}`);
  }

  const outboxPath = options.outboxPath || process.env.MORROWISE_NOTIFICATION_OUTBOX || DEFAULT_OUTBOX_PATH;
  fs.mkdirSync(path.dirname(outboxPath), { recursive: true });
  fs.writeFileSync(outboxPath, `${JSON.stringify(notification)}\n`, { flag: "a" });
  return notification;
}

export function validateNotification(notification) {
  const errors = [];
  if (!notification || typeof notification !== "object" || Array.isArray(notification)) {
    return { valid: false, errors: ["notification must be an object"] };
  }

  const keys = Object.keys(notification);
  for (const key of keys) {
    if (!ALLOWED_FIELDS.includes(key)) errors.push(`unknown field: ${key}`);
    if (FORBIDDEN_FIELDS.includes(key)) errors.push(`forbidden field: ${key}`);
  }

  requireString(notification, "schema_version", errors);
  requireString(notification, "id", errors);
  requireString(notification, "level", errors);
  requireString(notification, "title", errors);
  requireString(notification, "body", errors);
  requireString(notification, "created_at", errors);
  requireString(notification, "dedupe_key", errors);
  requireString(notification, "source", errors);
  if (typeof notification.task_anchor !== "string") errors.push("task_anchor must be a string");

  if (notification.schema_version !== NOTIFICATION_SCHEMA_VERSION) {
    errors.push(`schema_version must be ${NOTIFICATION_SCHEMA_VERSION}`);
  }
  if (typeof notification.id === "string" && !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{2,96}$/.test(notification.id)) {
    errors.push("id must be 3-97 chars and contain only letters, numbers, dot, underscore, colon, or dash");
  }
  if (!LEVELS.includes(notification.level)) {
    errors.push(`level must be one of: ${LEVELS.join(", ")}`);
  }
  if (typeof notification.title === "string" && [...notification.title].length > 80) {
    errors.push("title must be 80 chars or fewer");
  }
  if (typeof notification.body === "string" && [...notification.body].length > 240) {
    errors.push("body must be 240 chars or fewer");
  }
  if (!Number.isInteger(notification.ttl_seconds) || notification.ttl_seconds < 60 || notification.ttl_seconds > 86400) {
    errors.push("ttl_seconds must be an integer between 60 and 86400");
  }
  if (Number.isNaN(Date.parse(notification.created_at))) {
    errors.push("created_at must be an ISO timestamp");
  }

  return { valid: errors.length === 0, errors };
}

export function planNotificationDelivery(entries, options = {}) {
  const now = new Date(options.now || new Date());
  const deliveredIds = options.deliveredIds || new Set();
  const maxPerMinute = options.maxPerMinute ?? 3;
  const skipped = [];
  const eligible = [];

  for (const entry of entries) {
    const result = validateNotification(entry);
    if (!result.valid) {
      skipped.push({ id: entry?.id || null, reason: "invalid", errors: result.errors });
      continue;
    }
    if (deliveredIds.has(entry.id) || deliveredIds.has(entry.dedupe_key)) {
      skipped.push({ id: entry.id, reason: "already_delivered" });
      continue;
    }
    if (isExpired(entry, now)) {
      skipped.push({ id: entry.id, reason: "expired" });
      continue;
    }
    eligible.push(entry);
  }

  eligible.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  if (eligible.length <= maxPerMinute) {
    return { deliveries: eligible, skipped };
  }

  const directCount = Math.max(0, maxPerMinute - 1);
  const direct = eligible.slice(0, directCount);
  const overflow = eligible.slice(directCount);
  return {
    deliveries: [...direct, buildMergedNotification(overflow, now.toISOString())],
    skipped,
  };
}

function buildMergedNotification(entries, createdAt) {
  const ids = entries.map((entry) => entry.id);
  const level = entries.some((entry) => entry.level === "red") ? "red" : "amber";
  const digest = crypto.createHash("sha256").update(ids.join("|")).digest("hex").slice(0, 12);
  return buildNotification({
    id: `merged-${digest}`,
    level,
    title: "MorroWise notification digest",
    body: `${entries.length} notifications merged: ${ids.slice(0, 5).join(", ")}`,
    created_at: createdAt,
    ttl_seconds: DEFAULT_TTL_SECONDS,
    dedupe_key: `merged-${digest}`,
    source: "morrowise-notifier",
    task_anchor: "$COLLAB/harness-mc/milestones/morrowise/tasks.json#notification-first-delivery",
  });
}

function isExpired(entry, now) {
  const createdAt = new Date(entry.created_at);
  return createdAt.getTime() + entry.ttl_seconds * 1000 < now.getTime();
}

function requireString(object, field, errors) {
  if (typeof object[field] !== "string" || object[field].trim() === "") {
    errors.push(`${field} must be a non-empty string`);
  }
}

function buildNotificationId(input, createdAt) {
  const seed = `${input.level || "info"}|${input.title || ""}|${input.body || ""}|${createdAt}`;
  return `notif-${crypto.createHash("sha256").update(seed).digest("hex").slice(0, 16)}`;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) throw new Error(`unknown argument: ${arg}`);
    const key = arg.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) throw new Error(`missing value for ${arg}`);
    args[key] = value;
    i += 1;
  }
  return args;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const notification = buildNotification({
    id: args.id,
    level: args.level,
    title: args.title,
    body: args.body,
    source: args.source,
    task_anchor: args.taskAnchor,
    ttl_seconds: args.ttlSeconds ? Number(args.ttlSeconds) : undefined,
  });
  appendNotification(notification);
  console.log(`notification queued: ${notification.id}`);
}
