#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const collabRoot = path.resolve(__dirname, "..", "..");

// Target Contract
export const TARGET_CARD_ID = "76fcfdca-251c-412f-898c-24512e6ea144";
export const EXPECTED_TITLE = "MorroWise 使用說明書";
export const SUPPORTED_CLI_VERSION = "0.6.0";
export const START_SENTINEL = "<!-- morrowise-manual-sync:start:v1 -->";
export const END_SENTINEL = "<!-- morrowise-manual-sync:end:v1 -->";

export const SOURCE_MANUAL_PATH = path.join(collabRoot, "notyet-harness", "000_Agent", "docs", "morrowise", "MANUAL.md");
export const SYSTEM_JSON_PATH = path.join(collabRoot, "harness-mc", "public", "data", "morrowise-system.json");
export const BACKUP_ROOT = path.join(os.homedir(), "Library", "Application Support", "MorroWise", "heptabase-manual-sync", "backups");

// Exit Codes
export const EXIT_SUCCESS = 0;
export const EXIT_DRIFT = 1;
export const EXIT_SAFETY_GATE = 2;
export const EXIT_CONFLICT = 3;
export const EXIT_OFFLINE = 4;
export const EXIT_INDETERMINATE = 5;
export const EXIT_USAGE = 64;

export function getCliBin() {
  if (process.env.HEPTABASE_CLI_BIN) {
    return process.env.HEPTABASE_CLI_BIN;
  }
  const defaultPath = "/usr/local/bin/heptabase";
  if (fs.existsSync(defaultPath)) return defaultPath;
  return "heptabase";
}

export function parseArgs(argv) {
  const options = {
    mode: "dry-run",
    apply: false,
    yes: false,
    initializeMarkers: false,
    renderOnly: false,
    check: false,
    json: false,
    manualPath: SOURCE_MANUAL_PATH,
    cardId: TARGET_CARD_ID,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--render-only") {
      options.renderOnly = true;
    } else if (arg === "--dry-run") {
      // default
    } else if (arg === "--check") {
      options.check = true;
    } else if (arg === "--apply") {
      options.apply = true;
    } else if (arg === "--yes") {
      options.yes = true;
    } else if (arg === "--initialize-markers") {
      options.initializeMarkers = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--manual-path") {
      options.manualPath = argv[++i];
    } else if (arg === "--card-id") {
      options.cardId = argv[++i];
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(EXIT_SUCCESS);
    } else {
      console.error(`Unknown option: ${arg}`);
      process.exit(EXIT_USAGE);
    }
  }

  // Validate combinations
  if (options.renderOnly) {
    if (options.apply || options.check || options.initializeMarkers) {
      console.error("Error: --render-only cannot be combined with --apply, --check, or --initialize-markers");
      process.exit(EXIT_USAGE);
    }
    options.mode = "render-only";
    return options;
  }

  if (options.check) {
    if (options.apply || options.initializeMarkers) {
      console.error("Error: --check cannot be combined with --apply or --initialize-markers");
      process.exit(EXIT_USAGE);
    }
    options.mode = "check";
    return options;
  }

  if (options.apply) {
    if (!options.yes) {
      console.error("Error: --apply requires explicit --yes confirmation flag");
      process.exit(EXIT_USAGE);
    }
    options.mode = options.initializeMarkers ? "initialize" : "apply";
    return options;
  }

  if (options.yes) {
    console.error("Error: --yes cannot be used without --apply");
    process.exit(EXIT_USAGE);
  }

  if (options.initializeMarkers) {
    console.error("Error: --initialize-markers requires --apply --yes");
    process.exit(EXIT_USAGE);
  }

  options.mode = "dry-run";
  return options;
}

function printUsage() {
  console.log(`
Usage: node scripts/sync-heptabase-manual.mjs [options]

Modes:
  --render-only                     Parse and output ProseMirror AST from local MANUAL.md offline
  --dry-run (default)               Compare local MANUAL.md with live Heptabase card, show diff
  --check                           Verify if Heptabase card is synchronized with local MANUAL.md
  --apply --yes                     Sync local MANUAL.md to Heptabase card (requires backup)
  --initialize-markers --apply --yes Initial one-time append of markers to card

Options:
  --json                            Output results in JSON format
  --manual-path <path>              Override path to MANUAL.md
  --card-id <id>                    Override target Card ID (must match expected identity)
`);
}

// ---------------------------------------------------------------------------
// Inline & Markdown to ProseMirror Parser
// ---------------------------------------------------------------------------

export function parseInline(text) {
  if (!text) return [];

  const tokens = [];
  const regex = /(`[^`]+`)|(\[[^\]]+\]\([^)]+\))|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(_[^_]+_)/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: "text", text: text.slice(lastIndex, match.index) });
    }
    const full = match[0];
    if (full.startsWith("`")) {
      tokens.push({
        type: "text",
        text: full.slice(1, -1),
        marks: [{ type: "code" }]
      });
    } else if (full.startsWith("[")) {
      const linkMatch = full.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (linkMatch) {
        tokens.push({
          type: "text",
          text: linkMatch[1],
          marks: [{ type: "link", attrs: { href: linkMatch[2] } }]
        });
      }
    } else if (full.startsWith("**")) {
      tokens.push({
        type: "text",
        text: full.slice(2, -2),
        marks: [{ type: "strong" }]
      });
    } else if (full.startsWith("*") || full.startsWith("_")) {
      tokens.push({
        type: "text",
        text: full.slice(1, -1),
        marks: [{ type: "em" }]
      });
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    tokens.push({ type: "text", text: text.slice(lastIndex) });
  }

  return tokens;
}

export function markdownToProseMirror(markdown) {
  const clean = markdown.replace(/\r\n/g, "\n");

  const markersToRemove = new Set([
    "<!-- current-system-map:start -->",
    "<!-- current-system-map:end -->",
    "<!-- agent-routing:start -->",
    "<!-- agent-routing:end -->",
    "<!-- open-loops:start -->",
    "<!-- open-loops:end -->",
    "<!-- next-anchors:start -->",
    "<!-- next-anchors:end -->"
  ]);

  const lines = clean.split("\n").filter(line => !markersToRemove.has(line.trim()));
  const nodes = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    // Heading: #..######
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      nodes.push({
        type: "heading",
        attrs: { level: headingMatch[1].length },
        content: parseInline(headingMatch[2])
      });
      i++;
      continue;
    }

    // Code block: ```
    if (trimmed.startsWith("```")) {
      const lang = trimmed.slice(3).trim();
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;
      nodes.push({
        type: "code_block",
        attrs: { params: lang || "" },
        content: [{ type: "text", text: codeLines.join("\n") }]
      });
      continue;
    }

    // Blockquote: > ...
    if (trimmed.startsWith(">")) {
      const quoteLines = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        quoteLines.push(lines[i].trim().replace(/^>\s*/, ""));
        i++;
      }
      nodes.push({
        type: "blockquote",
        content: quoteLines.map(ql => ({
          type: "paragraph",
          content: parseInline(ql)
        }))
      });
      continue;
    }

    // Table
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      const tableLines = [];
      while (i < lines.length && lines[i].trim().startsWith("|") && lines[i].trim().endsWith("|")) {
        tableLines.push(lines[i].trim());
        i++;
      }
      if (tableLines.length >= 2) {
        const parseRow = (rowLine) => {
          return rowLine.split("|").slice(1, -1).map(p => p.trim());
        };
        const headers = parseRow(tableLines[0]);
        const rows = tableLines.slice(2).map(parseRow);

        const tableNode = {
          type: "table",
          attrs: { hasRowHeader: false, hasColumnHeader: false },
          content: [
            {
              type: "table_row",
              attrs: {},
              content: headers.map(h => ({
                type: "table_header",
                attrs: { colspan: 1, rowspan: 1, colwidth: null, backgroundColor: null, textColor: null },
                content: [{ type: "paragraph", content: parseInline(h) }]
              }))
            },
            ...rows.map(r => ({
              type: "table_row",
              attrs: {},
              content: r.map(c => ({
                type: "table_cell",
                attrs: { colspan: 1, rowspan: 1, colwidth: null, backgroundColor: null, textColor: null },
                content: [{ type: "paragraph", content: parseInline(c) }]
              }))
            }))
          ]
        };
        nodes.push(tableNode);
        continue;
      }
    }

    // Unordered List: - or *
    if (/^[-*]\s+/.test(trimmed)) {
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        const itemText = lines[i].trim().replace(/^[-*]\s+/, "");
        nodes.push({
          type: "bullet_list_item",
          attrs: { folded: false, format: null },
          content: [{ type: "paragraph", content: parseInline(itemText) }]
        });
        i++;
      }
      continue;
    }

    // Ordered List: \d+\.
    if (/^\d+\.\s+/.test(trimmed)) {
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        const itemText = lines[i].trim().replace(/^\d+\.\s+/, "");
        nodes.push({
          type: "numbered_list_item",
          attrs: { order: null, format: null },
          content: [{ type: "paragraph", content: parseInline(itemText) }]
        });
        i++;
      }
      continue;
    }

    // Normal Paragraph
    const paraLines = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].trim().startsWith("#") &&
      !lines[i].trim().startsWith("```") &&
      !lines[i].trim().startsWith(">") &&
      !(lines[i].trim().startsWith("|") && lines[i].trim().endsWith("|")) &&
      !/^[-*]\s+/.test(lines[i].trim()) &&
      !/^\d+\.\s+/.test(lines[i].trim())
    ) {
      paraLines.push(lines[i].trim());
      i++;
    }
    nodes.push({
      type: "paragraph",
      content: parseInline(paraLines.join(" "))
    });
  }

  return nodes;
}

// ---------------------------------------------------------------------------
// Marker Contract & AST Manipulation
// ---------------------------------------------------------------------------

export function isSentinelNode(node, sentinelText) {
  if (!node || node.type !== "paragraph") return false;
  if (!Array.isArray(node.content) || node.content.length !== 1) return false;
  const child = node.content[0];
  if (child.type !== "text" || child.text !== sentinelText) return false;
  if (child.marks && child.marks.length > 0) return false;
  return true;
}

export function createSentinelNode(sentinelText) {
  return {
    type: "paragraph",
    content: [{ type: "text", text: sentinelText }]
  };
}

export function findMarkers(contentNodes) {
  const startIndices = [];
  const endIndices = [];

  for (let idx = 0; idx < contentNodes.length; idx++) {
    const node = contentNodes[idx];
    if (isSentinelNode(node, START_SENTINEL)) {
      startIndices.push(idx);
    } else if (isSentinelNode(node, END_SENTINEL)) {
      endIndices.push(idx);
    }
  }

  return { startIndices, endIndices };
}

export function validateMarkers(contentNodes, mode) {
  const { startIndices, endIndices } = findMarkers(contentNodes);

  if (mode === "initialize") {
    if (startIndices.length === 0 && endIndices.length === 0) {
      return { valid: true, startIndex: -1, endIndex: -1 };
    }
    return {
      valid: false,
      reason: `Initialization requires both markers absent; found start=${startIndices.length}, end=${endIndices.length}`
    };
  }

  if (startIndices.length === 0 && endIndices.length === 0) {
    return {
      valid: false,
      reason: "Markers not found. If this is an uninitialized card, run with --initialize-markers --apply --yes."
    };
  }

  if (startIndices.length !== 1 || endIndices.length !== 1) {
    return {
      valid: false,
      reason: `Invalid marker cardinality: start count=${startIndices.length}, end count=${endIndices.length}`
    };
  }

  const startIndex = startIndices[0];
  const endIndex = endIndices[0];

  if (startIndex >= endIndex) {
    return {
      valid: false,
      reason: `Reversed markers: start index ${startIndex} >= end index ${endIndex}`
    };
  }

  return { valid: true, startIndex, endIndex };
}

export function replaceManagedNodes(docContent, managedNodes, startIndex, endIndex) {
  const beforeSlice = docContent.slice(0, startIndex + 1);
  const afterSlice = docContent.slice(endIndex);
  return [...beforeSlice, ...managedNodes, ...afterSlice];
}

export function initializeMarkers(docContent, managedNodes) {
  const startNode = createSentinelNode(START_SENTINEL);
  const endNode = createSentinelNode(END_SENTINEL);
  return [...docContent, startNode, ...managedNodes, endNode];
}

export function stripNodeIds(node) {
  if (Array.isArray(node)) return node.map(stripNodeIds);
  if (!node || typeof node !== "object") return node;
  const copy = {};
  const keys = Object.keys(node).sort();
  for (const key of keys) {
    if (key === "attrs" && node.attrs && typeof node.attrs === "object") {
      const { id, ...restAttrs } = node.attrs;
      if (Object.keys(restAttrs).length > 0) {
        copy.attrs = stripNodeIds(restAttrs);
      }
    } else {
      copy[key] = stripNodeIds(node[key]);
    }
  }
  return copy;
}

export function areNodesEqual(nodesA, nodesB) {
  return JSON.stringify(stripNodeIds(nodesA)) === JSON.stringify(stripNodeIds(nodesB));
}

// ---------------------------------------------------------------------------
// Backup Management
// ---------------------------------------------------------------------------

export function createBackup(cardId, contentMd5, rawReadPayload) {
  const cardBackupDir = path.join(BACKUP_ROOT, cardId);
  fs.mkdirSync(cardBackupDir, { recursive: true, mode: 0o700 });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFileName = `${timestamp}-${contentMd5}.json`;
  const backupFilePath = path.join(cardBackupDir, backupFileName);

  const payloadStr = typeof rawReadPayload === "string" ? rawReadPayload : JSON.stringify(rawReadPayload, null, 2);
  fs.writeFileSync(backupFilePath, payloadStr, { encoding: "utf-8", mode: 0o600 });

  // Read back and verify sha256
  const written = fs.readFileSync(backupFilePath, "utf-8");
  const expectedHash = crypto.createHash("sha256").update(payloadStr).digest("hex");
  const actualHash = crypto.createHash("sha256").update(written).digest("hex");

  if (expectedHash !== actualHash) {
    throw new Error(`Backup verification failed for ${backupFilePath}`);
  }

  return { backupFilePath, sha256: actualHash };
}

// ---------------------------------------------------------------------------
// CLI Client & Concurrency Management
// ---------------------------------------------------------------------------

export function runCli(args, timeoutMs = 15000) {
  const cliBin = getCliBin();
  let result;
  try {
    result = spawnSync(cliBin, args, {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
      timeout: timeoutMs,
      env: process.env,
    });
  } catch (err) {
    return {
      status: EXIT_OFFLINE,
      stdout: "",
      stderr: String(err),
      error: err,
    };
  }

  if (result.error) {
    if (result.error.code === "ETIMEDOUT") {
      return { status: 124, stdout: result.stdout || "", stderr: "Timeout", error: result.error };
    }
    return { status: EXIT_OFFLINE, stdout: result.stdout || "", stderr: String(result.error), error: result.error };
  }

  return {
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

export function readNote(cardId) {
  const res = runCli(["note", "read", cardId]);
  if (res.status !== 0) {
    const isOffline = res.status === 126 || res.stderr.includes("ECONNREFUSED") || res.stderr.includes("offline") || res.stderr.includes("connect");
    return {
      success: false,
      exitCode: isOffline ? EXIT_OFFLINE : EXIT_SAFETY_GATE,
      error: res.stderr || res.stdout || "Failed to read note"
    };
  }

  try {
    const data = JSON.parse(res.stdout);
    return {
      success: true,
      card: data,
      raw: res.stdout,
    };
  } catch (e) {
    return {
      success: false,
      exitCode: EXIT_SAFETY_GATE,
      error: `Malformed JSON from CLI read: ${e.message}`
    };
  }
}

export function saveNote(cardId, contentMd5, newDoc) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hepta-sync-"));
  const tmpFile = path.join(tmpDir, "content.json");
  const contentStr = JSON.stringify(newDoc);

  try {
    fs.writeFileSync(tmpFile, contentStr, { encoding: "utf-8", mode: 0o600 });
    const res = runCli(["note", "save", cardId, "--content-md5", contentMd5, "--content-file", tmpFile]);

    if (res.status !== 0) {
      if (res.stderr.includes("Conflict") || res.stderr.includes("mismatch") || res.stderr.includes("Stale content-md5")) {
        return { success: false, exitCode: EXIT_CONFLICT, error: res.stderr };
      }
      if (res.status === 124 || res.stderr.includes("timed out")) {
        return { success: false, exitCode: EXIT_INDETERMINATE, error: "Save operation timed out" };
      }
      if (res.status === 126 || res.stderr.includes("ECONNREFUSED") || res.stderr.includes("offline")) {
        return { success: false, exitCode: EXIT_OFFLINE, error: res.stderr };
      }
      return { success: false, exitCode: EXIT_INDETERMINATE, error: res.stderr || res.stdout };
    }

    return { success: true };
  } finally {
    try {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
      if (fs.existsSync(tmpDir)) fs.rmdirSync(tmpDir);
    } catch {}
  }
}

// ---------------------------------------------------------------------------
// Main Pipeline
// ---------------------------------------------------------------------------

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);

  // 1. Check local MANUAL.md
  if (!fs.existsSync(options.manualPath)) {
    console.error(`Safety gate error: source manual missing at ${options.manualPath}`);
    return EXIT_SAFETY_GATE;
  }
  const manualRaw = fs.readFileSync(options.manualPath, "utf-8");
  const managedNodes = markdownToProseMirror(manualRaw);

  if (options.mode === "render-only") {
    const summary = {
      mode: "render-only",
      nodeCount: managedNodes.length,
      nodeTypes: Array.from(new Set(managedNodes.map(n => n.type))),
      fingerprint: crypto.createHash("sha256").update(JSON.stringify(managedNodes)).digest("hex"),
      nodes: managedNodes
    };
    if (options.json) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      console.log(`Rendered ${managedNodes.length} ProseMirror nodes. Fingerprint: ${summary.fingerprint}`);
    }
    return EXIT_SUCCESS;
  }

  // 2. Read live card
  const readRes = readNote(options.cardId);
  if (!readRes.success) {
    console.error(`Read error: ${readRes.error}`);
    return readRes.exitCode;
  }

  const card = readRes.card;

  // 3. Identity Verification
  if (card.id !== TARGET_CARD_ID) {
    console.error(`Safety gate error: Target Card ID mismatch. Expected ${TARGET_CARD_ID}, got ${card.id}`);
    return EXIT_SAFETY_GATE;
  }
  if (card.title !== EXPECTED_TITLE) {
    console.error(`Safety gate error: Target Title mismatch. Expected "${EXPECTED_TITLE}", got "${card.title}"`);
    return EXIT_SAFETY_GATE;
  }

  let currentDoc;
  try {
    currentDoc = typeof card.content === "string" ? JSON.parse(card.content) : card.content;
    if (!currentDoc || currentDoc.type !== "doc" || !Array.isArray(currentDoc.content)) {
      throw new Error("Missing doc.content array");
    }
  } catch (e) {
    console.error(`Safety gate error: Card content is not a valid ProseMirror doc: ${e.message}`);
    return EXIT_SAFETY_GATE;
  }

  // 4. Marker Validation
  const markerCheck = validateMarkers(currentDoc.content, options.mode);
  if (!markerCheck.valid) {
    console.error(`Marker validation error: ${markerCheck.reason}`);
    return EXIT_SAFETY_GATE;
  }

  // 5. Build New Doc
  let newDocContent;
  let hasChange = false;

  if (options.mode === "initialize") {
    newDocContent = initializeMarkers(currentDoc.content, managedNodes);
    hasChange = true;
  } else {
    const currentManaged = currentDoc.content.slice(markerCheck.startIndex + 1, markerCheck.endIndex);
    hasChange = !areNodesEqual(currentManaged, managedNodes);
    newDocContent = replaceManagedNodes(currentDoc.content, managedNodes, markerCheck.startIndex, markerCheck.endIndex);
  }

  const newDoc = {
    type: "doc",
    content: newDocContent
  };

  // 6. Check Mode
  if (options.mode === "check") {
    if (hasChange) {
      console.log("Drift detected: Heptabase card managed region is out of sync with local MANUAL.md");
      return EXIT_DRIFT;
    }
    console.log("Heptabase card is in sync with local MANUAL.md");
    return EXIT_SUCCESS;
  }

  // 7. Dry Run Mode
  if (options.mode === "dry-run") {
    const summary = {
      mode: "dry-run",
      target: { id: card.id, title: card.title, contentMd5: card.contentMd5 },
      hasChange,
      saveCount: 0,
      currentManagedNodes: options.mode === "initialize" ? 0 : markerCheck.endIndex - markerCheck.startIndex - 1,
      renderedManagedNodes: managedNodes.length,
      managedFingerprint: crypto.createHash("sha256").update(JSON.stringify(managedNodes)).digest("hex"),
    };
    if (options.json) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      console.log(`[DRY RUN] Target: ${card.title} (${card.id})`);
      console.log(`Status: ${hasChange ? "Pending update" : "Already in sync"}`);
      console.log(`Rendered nodes: ${managedNodes.length}. Mutations: 0`);
    }
    return EXIT_SUCCESS;
  }

  // 8. Apply Mode
  if (!hasChange) {
    console.log("No changes detected. Save skipped.");
    return EXIT_SUCCESS;
  }

  // A. Backup
  let backupInfo;
  try {
    backupInfo = createBackup(card.id, card.contentMd5, readRes.raw);
    console.log(`Backup created: ${backupInfo.backupFilePath} (SHA-256: ${backupInfo.sha256.slice(0, 12)}...)`);
  } catch (err) {
    console.error(`Backup failed: ${err.message}`);
    return EXIT_SAFETY_GATE;
  }

  // B. Save
  const saveRes = saveNote(card.id, card.contentMd5, newDoc);
  if (!saveRes.success) {
    console.error(`Save failed: ${saveRes.error}`);
    // Reconciliation if indeterminate
    if (saveRes.exitCode === EXIT_INDETERMINATE) {
      const recon = readNote(card.id);
      if (recon.success) {
        const reconDoc = typeof recon.card.content === "string" ? JSON.parse(recon.card.content) : recon.card.content;
        if (areNodesEqual(reconDoc.content, newDoc.content)) {
          console.log("Reconciliation: Save was confirmed applied.");
          return EXIT_SUCCESS;
        }
        if (recon.card.contentMd5 === card.contentMd5) {
          console.log("Reconciliation: Save confirmed not applied.");
          return EXIT_OFFLINE;
        }
      }
    }
    return saveRes.exitCode;
  }

  // C. Post-fetch Verification
  const postRead = readNote(card.id);
  if (!postRead.success) {
    console.error(`Post-fetch verification failed: ${postRead.error}`);
    return EXIT_INDETERMINATE;
  }

  const postDoc = typeof postRead.card.content === "string" ? JSON.parse(postRead.card.content) : postRead.card.content;
  if (!areNodesEqual(postDoc.content, newDoc.content)) {
    console.error("Post-fetch verification failed: AST content does not match expected state.");
    return EXIT_INDETERMINATE;
  }

  console.log(`Successfully synced MorroWise manual to Heptabase card ${card.id}. Latest MD5: ${postRead.card.contentMd5}`);
  return EXIT_SUCCESS;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((err) => {
    console.error(err);
    process.exitCode = EXIT_SAFETY_GATE;
  });
}
