import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const collabRoot = path.resolve(root, "..");

const args = process.argv.slice(2);
const canvasDir = path.resolve(root, "../notyet-harness/300_Obsidian_brain/ACP/canvas");

function readArg(name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  return args[index + 1] || fallback;
}

function hasArg(name) {
  return args.includes(name);
}

function readOptionalPathArg(name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) return fallback;
  return value;
}

const whiteboard = readArg("--whiteboard", "MC 儀表版");
const sourcePath = path.resolve(root, readArg("--source", "public/data/projects.json"));
const explicitOut = readArg("--out", null);

function canvasFileName(name) {
  return `${String(name).replace(/[\\/:*?"<>|]/g, "-").trim() || "untitled"}.canvas`;
}

const outPath = explicitOut
  ? path.resolve(root, explicitOut)
  : path.join(canvasDir, canvasFileName(whiteboard));
const resizeExistingPath = readOptionalPathArg("--resize-existing", outPath);

function stableId(...parts) {
  return crypto.createHash("sha1").update(parts.join(":")).digest("hex").slice(0, 16);
}

function statusLabel(status) {
  const labels = {
    done: "done",
    completed: "done",
    fixed: "done",
    in_progress: "in progress",
    blocked: "blocked",
    deferred: "deferred",
    todo: "todo",
    not_started: "todo",
  };
  return labels[status] || status || "todo";
}

function statusColor(status) {
  if (["done", "completed", "fixed"].includes(status)) return "4";
  if (status === "in_progress") return "5";
  if (status === "blocked") return "1";
  if (status === "deferred") return "6";
  return "2";
}

function taskLabel(task) {
  return task.order_label ? `[${task.order_label}] ${task.title}` : task.title;
}

function compactText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function shortCardId(cardId) {
  return cardId ? `${cardId.slice(0, 8)}…` : "";
}

function fieldLines(label, value) {
  const text = compactText(value);
  if (!text) return [];
  return [`**${label}**`, text];
}

function cardText(project, task) {
  const heptabase = task.external_refs?.heptabase || {};
  const lines = [
    `## ${taskLabel(task)}`,
    `**Track:** ${task.track || "unknown"}`,
    `**Status:** ${statusLabel(task.status)}`,
  ];

  lines.push(...fieldLines("內容", task.summary || task.note));
  lines.push(...fieldLines("完成標準", task.done_condition));

  if (heptabase.card_id) {
    lines.push(
      "**Refs**",
      `Project: \`${project.project}\``,
      `Task: \`${task.id}\``,
      `Heptabase: \`${shortCardId(heptabase.card_id)}\``,
    );
  } else {
    lines.push("**Refs**", `Project: \`${project.project}\``, `Task: \`${task.id}\``);
  }

  return lines.join("\n");
}

function visualUnits(value) {
  return [...String(value)].reduce((sum, char) => {
    if (/[\u3000-\u9fff\uff00-\uffef]/u.test(char)) return sum + 1;
    if (/\s/u.test(char)) return sum + 0.28;
    return sum + 0.56;
  }, 0);
}

function plainMarkdownLine(line) {
  return String(line)
    .replace(/^#{1,6}\s+/, "")
    .replace(/\*\*/g, "")
    .replace(/`/g, "");
}

function estimateTextHeight(text, width, options = {}) {
  const minHeight = options.minHeight ?? 160;
  const padding = options.padding ?? 54;
  const unitsPerLine = Math.max(18, Math.floor(width / 16));
  const height = text.split("\n").reduce((sum, rawLine) => {
    const line = plainMarkdownLine(rawLine).trim();
    if (!line) return sum + 10;

    const wrappedLines = Math.max(1, Math.ceil(visualUnits(line) / unitsPerLine));
    const lineHeight = rawLine.startsWith("## ") ? 27 : rawLine.startsWith("**") ? 23 : 21;
    return sum + wrappedLines * lineHeight;
  }, padding);

  return Math.max(minHeight, Math.ceil(height));
}

function nodeBottom(node) {
  return (node.y || 0) + (node.height || 0);
}

function sameColumn(a, b) {
  return a.type === "text" && b.type === "text" && Math.abs((a.x || 0) - (b.x || 0)) < 8;
}

function resizeExistingCanvas(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`Missing canvas: ${path.relative(collabRoot, filePath)}`);
    process.exit(1);
  }

  const canvas = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  const textNodes = (canvas.nodes || [])
    .filter((node) => node.type === "text" && typeof node.text === "string" && typeof node.width === "number")
    .sort((a, b) => (a.x || 0) - (b.x || 0) || (a.y || 0) - (b.y || 0));

  let resized = 0;
  for (const node of textNodes) {
    const newHeight = estimateTextHeight(node.text, node.width, {
      minHeight: node.text.startsWith("# ") ? 220 : 160,
      padding: node.text.startsWith("# ") ? 46 : 54,
    });
    const delta = newHeight - (node.height || 0);
    if (Math.abs(delta) < 1) continue;

    const originalBottom = nodeBottom(node);
    node.height = newHeight;
    resized += 1;

    for (const other of canvas.nodes || []) {
      if (other.id === node.id) continue;
      if (!sameColumn(node, other)) continue;
      if ((other.y || 0) >= originalBottom - 1) {
        other.y = Math.round((other.y || 0) + delta);
      }
    }
  }

  for (const group of (canvas.nodes || []).filter((node) => node.type === "group")) {
    const contained = (canvas.nodes || []).filter((node) => {
      if (node.id === group.id || node.type === "group") return false;
      const x = node.x || 0;
      const y = node.y || 0;
      return x >= (group.x || 0) && x <= (group.x || 0) + (group.width || 0) && y >= (group.y || 0);
    });
    if (contained.length === 0) continue;
    const bottom = Math.max(...contained.map(nodeBottom));
    group.height = Math.max(group.height || 0, Math.ceil(bottom - (group.y || 0) + 20));
  }

  fs.writeFileSync(filePath, `${JSON.stringify(canvas, null, 2)}\n`);
  console.log(`Resized ${path.relative(collabRoot, filePath)}`);
  console.log(`${resized} text cards resized`);
}

function bucketText(bucket) {
  const done = bucket.items.filter(({ task }) => ["done", "completed", "fixed"].includes(task.status)).length;
  const doing = bucket.items.filter(({ task }) => task.status === "in_progress").length;
  const todo = bucket.items.filter(({ task }) => ["todo", "not_started"].includes(task.status)).length;
  const projects = [...new Set(bucket.items.map(({ project }) => project.project))].join(", ");

  return [
    `## ${bucket.title}`,
    "",
    bucket.description,
    "",
    `Projects: \`${projects}\``,
    `Cards: ${bucket.items.length}`,
    `Done: ${done} / Doing: ${doing} / Todo: ${todo}`,
  ].join("\n");
}

function sortTasks(a, b) {
  const ao = a.order ?? Number.POSITIVE_INFINITY;
  const bo = b.order ?? Number.POSITIVE_INFINITY;
  if (ao !== bo) return ao - bo;
  return (a.order_label || a.id).localeCompare(b.order_label || b.id);
}

if (hasArg("--resize-existing")) {
  const target = path.isAbsolute(resizeExistingPath)
    ? resizeExistingPath
    : path.resolve(root, resizeExistingPath);
  resizeExistingCanvas(target);
  process.exit(0);
}

if (!fs.existsSync(sourcePath)) {
  console.error(`Missing source data: ${path.relative(root, sourcePath)}`);
  console.error("Run: node scripts/generate-data.mjs");
  process.exit(1);
}

const projects = JSON.parse(fs.readFileSync(sourcePath, "utf-8"));
const selected = [];

for (const project of projects) {
  const tasks = project.tasks
    .filter((task) => task.external_refs?.heptabase?.whiteboard === whiteboard)
    .sort(sortTasks);
  if (tasks.length > 0) selected.push({ project, tasks });
}

const totalTasks = selected.reduce((sum, item) => sum + item.tasks.length, 0);
const generatedAt = new Date().toISOString();
const nodes = [];
const edges = [];

function existingCanvasWhiteboard(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const canvas = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    const firstText = canvas.nodes?.find((node) => node.type === "text" && node.text)?.text || "";
    const firstLine = firstText.split("\n")[0] || "";
    return firstLine.startsWith("# ") ? firstLine.slice(2).trim() : null;
  } catch {
    return null;
  }
}

const existingWhiteboard = existingCanvasWhiteboard(outPath);
if (existingWhiteboard && existingWhiteboard !== whiteboard) {
  console.error(`Refusing to overwrite ${path.relative(collabRoot, outPath)}`);
  console.error(`Existing canvas is for "${existingWhiteboard}", requested "${whiteboard}".`);
  console.error("Pass --out explicitly if this replacement is intentional.");
  process.exit(1);
}

const bucketDefs = [
  {
    id: "heptabase-lifecycle",
    title: "Heptabase lifecycle",
    description: "CLI adapter, append, write-back, title update, refresh.",
    matches: (_project, task) => String(task.order_label || "").startsWith("ACP-HB"),
  },
  {
    id: "acp-system-rules",
    title: "ACP system rules",
    description: "Task, skill, runtime, eval, and registry protocols.",
    matches: (project, task) => project.project === "dual-blade"
      && !String(task.order_label || "").startsWith("ACP-OBS"),
  },
  {
    id: "obsidian-transition",
    title: "Obsidian transition",
    description: "Canvas mirror, visual-layer boundary, artifact policy.",
    matches: (_project, task) => String(task.order_label || "").startsWith("ACP-OBS"),
  },
  {
    id: "mc-dashboard-implementation",
    title: "MC dashboard implementation",
    description: "Mission Control UI, read model, validators, write map.",
    matches: (project) => project.project === "harness-mc",
  },
];

function bucketFor(project, task) {
  return bucketDefs.find((bucket) => bucket.matches(project, task)) || {
    id: "other",
    title: "Other",
    description: "Cards that do not match a named control-plane lane.",
  };
}

function sortItems(a, b) {
  if (a.bucketId === "obsidian-transition" && a.task.order_label && b.task.order_label) {
    return a.task.order_label.localeCompare(b.task.order_label, "en", { numeric: true });
  }
  return sortTasks(a.task, b.task);
}

const bucketMap = new Map();

for (const { project, tasks } of selected) {
  for (const task of tasks) {
    const bucket = bucketFor(project, task);
    if (!bucketMap.has(bucket.id)) {
      bucketMap.set(bucket.id, { ...bucket, items: [] });
    }
    bucketMap.get(bucket.id).items.push({ project, task, bucketId: bucket.id });
  }
}

const buckets = [
  ...bucketDefs.map((bucket) => bucketMap.get(bucket.id)).filter(Boolean),
  ...[...bucketMap.values()].filter((bucket) => !bucketDefs.some((def) => def.id === bucket.id)),
].map((bucket) => ({
  ...bucket,
  items: bucket.items.sort(sortItems),
}));

nodes.push({
  id: stableId("canvas", whiteboard, "summary"),
  type: "text",
  text: [
    `# ${whiteboard}`,
    "",
    "MC → Obsidian Canvas sync",
    "",
    `Generated: ${generatedAt}`,
    `Source: \`$COLLAB/harness-mc/public/data/projects.json\``,
    `Rule: tasks with \`external_refs.heptabase.whiteboard = ${whiteboard}\``,
    "",
    `Projects: ${selected.length}`,
    `Cards: ${totalTasks}`,
  ].join("\n"),
  x: -460,
  y: -260,
  width: 420,
  height: 260,
  color: "3",
});

const cardWidth = 400;
const columnGap = 64;
const gap = 24;
const taskGap = 18;
const groupPadding = 20;

buckets.forEach((bucket, bucketIndex) => {
  const x = bucketIndex * (cardWidth + columnGap);
  const y = -260;
  const bucketNodeId = stableId("bucket", bucket.id, whiteboard);
  const headerText = bucketText(bucket);
  const headerHeight = estimateTextHeight(headerText, cardWidth, { minHeight: 150, padding: 42 });
  let taskY = y + headerHeight + gap;
  const taskLayouts = bucket.items.map(({ project, task }) => {
    const text = cardText(project, task);
    const height = estimateTextHeight(text, cardWidth);
    const layout = { project, task, text, y: taskY, height };
    taskY += height + taskGap;
    return layout;
  });
  const groupHeight = taskY - y + gap - taskGap;

  nodes.push({
    id: stableId("group", bucket.id, whiteboard),
    type: "group",
    label: bucket.title,
    x: x - groupPadding,
    y: y - groupPadding,
    width: cardWidth + groupPadding * 2,
    height: groupHeight + groupPadding * 2,
    color: "6",
  });

  nodes.push({
    id: bucketNodeId,
    type: "text",
    text: headerText,
    x,
    y,
    width: cardWidth,
    height: headerHeight,
    color: "3",
  });

  taskLayouts.forEach(({ project, task, text, y: nodeY, height }) => {
    const taskNodeId = stableId("task", project.project, task.id);

    nodes.push({
      id: taskNodeId,
      type: "text",
      text,
      x,
      y: nodeY,
      width: cardWidth,
      height,
      color: statusColor(task.status),
    });

    edges.push({
      id: stableId("edge", project.project, task.id),
      fromNode: bucketNodeId,
      fromSide: "bottom",
      toNode: taskNodeId,
      toSide: "top",
    });
  });
});

const canvas = { nodes, edges };

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(canvas, null, 2)}\n`);

console.log(`Synced ${whiteboard} to ${path.relative(collabRoot, outPath)}`);
console.log(`${selected.length} projects, ${totalTasks} cards`);
