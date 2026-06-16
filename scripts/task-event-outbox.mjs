import fs from "node:fs";
import path from "node:path";

const REQUIRED_FIELDS = [
  "type",
  "repo",
  "commit",
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
    commit: input.commit,
    project: input.project,
    task_id: input.task_id,
    status: input.status || statusForEventType(input.type),
    summary: input.summary,
    created_at: createdAt,
    actor: input.actor,
    session_id: input.session_id,
  };

  const pendingDir = path.join(input.root || process.cwd(), "task-events", "pending");
  fs.mkdirSync(pendingDir, { recursive: true });

  const fileName = `${timestampSlug(createdAt)}-${slug(input.repo)}-${slug(input.commit)}-${slug(input.project)}-${slug(input.task_id)}.json`;
  const target = path.join(pendingDir, fileName);
  fs.writeFileSync(target, `${JSON.stringify(event, null, 2)}\n`, { flag: "wx" });

  return event;
}

function validateTaskEventInput(input) {
  for (const field of REQUIRED_FIELDS) {
    if (!input?.[field]) throw new Error(`${field} is required`);
  }

  if (!["task.completed", "task.commit_attached", "task.reopened", "task.blocked"].includes(input.type)) {
    throw new Error(`unsupported event type: ${input.type}`);
  }
}

function statusForEventType(type) {
  if (type === "task.completed") return "completed";
  if (type === "task.reopened") return "in_progress";
  if (type === "task.blocked") return "blocked";
  return "updated";
}

function buildEventId(input, createdAt) {
  return `${input.type}-${slug(input.project)}-${slug(input.task_id)}-${slug(input.commit)}-${timestampSlug(createdAt)}`;
}

function timestampSlug(value) {
  return new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function slug(value) {
  return String(value).trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}
