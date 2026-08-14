import fs from "node:fs";
import path from "node:path";

const REQUIRED_FIELDS = [
  "type",
  "repo",
  "project",
  "task_id",
  "summary",
  "actor",
  "session_id",
];

export function writeTaskEvent(input) {
  validateTaskEventInput(input);

  const createdAt = input.created_at || new Date().toISOString();
  const event = {
    event_id: input.event_id || buildEventId(input, createdAt),
    type: input.type,
    repo: input.repo,
    ...(input.commit ? { commit: input.commit } : {}),
    project: input.project,
    task_id: input.task_id,
    status: input.status || statusForEventType(input.type),
    summary: input.summary,
    created_at: createdAt,
    actor: input.actor,
    session_id: input.session_id,
    ...(input.coordination ? { coordination: input.coordination } : {}),
  };

  const pendingDir = path.join(input.root || process.cwd(), "task-events", "pending");
  fs.mkdirSync(pendingDir, { recursive: true });

  const eventIdentity = input.commit || input.coordination?.claim_id || input.coordination?.base_sha || "no-commit";
  const fileName = `${timestampSlug(createdAt)}-${slug(input.repo)}-${slug(input.type)}-${slug(eventIdentity)}-${slug(input.project)}-${slug(input.task_id)}.json`;
  const target = path.join(pendingDir, fileName);
  fs.writeFileSync(target, `${JSON.stringify(event, null, 2)}\n`, { flag: "wx" });

  return event;
}

function validateTaskEventInput(input) {
  for (const field of REQUIRED_FIELDS) {
    if (!input?.[field]) throw new Error(`${field} is required`);
  }

  const supported = [
    "task.completed",
    "task.commit_attached",
    "task.reopened",
    "task.blocked",
    "task.claimed",
    "task.remote_synced",
    "task.released",
  ];
  if (!supported.includes(input.type)) {
    throw new Error(`unsupported event type: ${input.type}`);
  }

  const coordinationTypes = new Set(["task.claimed", "task.remote_synced", "task.released"]);
  if (coordinationTypes.has(input.type)) validateCoordination(input);
  else if (!input.commit) throw new Error(`commit is required for ${input.type}`);

  if (input.type === "task.remote_synced" && !input.commit) {
    throw new Error("commit is required for task.remote_synced");
  }
}

function validateCoordination(input) {
  if (!input.coordination || typeof input.coordination !== "object") {
    throw new Error(`coordination is required for ${input.type}`);
  }
  const required = input.type === "task.claimed"
    ? ["claim_id", "repo_class", "branch", "base_sha", "claimed_at", "owner_role", "actor", "session_id", "remote_claim_ref", "remote_claim_sha", "remote_state"]
    : ["claim_id", "repo_class", "branch", "base_sha", "owner_role", "actor", "session_id", "remote_claim_ref", "remote_claim_sha", "remote_state"];
  const missing = required.filter((field) => !input.coordination[field]);
  if (missing.length > 0) throw new Error(`${missing.join(", ")} is required for ${input.type}`);
}

function statusForEventType(type) {
  if (type === "task.completed") return "completed";
  if (type === "task.reopened") return "in_progress";
  if (type === "task.blocked") return "blocked";
  return "updated";
}

function buildEventId(input, createdAt) {
  const eventIdentity = input.commit || input.coordination?.claim_id || input.coordination?.base_sha || "no-commit";
  return `${input.type}-${slug(input.project)}-${slug(input.task_id)}-${slug(eventIdentity)}-${timestampSlug(createdAt)}`;
}

function timestampSlug(value) {
  return new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function slug(value) {
  return String(value).trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}
