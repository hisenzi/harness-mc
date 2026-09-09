#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

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
export const SYSTEM_VERIFIER_PATH = path.join(collabRoot, "harness-mc", "scripts", "verify-morrowise-system-json.mjs");
export const MANUAL_SYNC_SCRIPT_PATH = path.join(collabRoot, "notyet-harness", "000_Agent", "scripts", "sync-morrowise-manual.py");
export const BACKUP_ROOT = process.env.HEPTABASE_BACKUP_DIR || path.join(os.homedir(), "Library", "Application Support", "MorroWise", "heptabase-manual-sync", "backups");

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
  const primaryModeFlags = new Set(["--render-only", "--dry-run", "--check", "--apply"]);
  const nonRepeatableFlags = new Set([
    ...primaryModeFlags,
    "--yes",
    "--initialize-markers",
    "--json",
    "--manual-path",
    "--card-id",
  ]);
  const seenFlags = new Set();
  let selectedModeFlag = null;
  let manualPathExplicit = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (nonRepeatableFlags.has(arg)) {
      if (seenFlags.has(arg)) {
        console.error(`Error: repeated option ${arg}`);
        process.exit(EXIT_USAGE);
      }
      seenFlags.add(arg);
    }
    if (primaryModeFlags.has(arg)) {
      if (selectedModeFlag !== null) {
        console.error(`Error: mode ${arg} conflicts with ${selectedModeFlag}`);
        process.exit(EXIT_USAGE);
      }
      selectedModeFlag = arg;
    }

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
      if (i + 1 >= argv.length || argv[i + 1].startsWith("--")) {
        console.error("Error: --manual-path requires a path value");
        process.exit(EXIT_USAGE);
      }
      options.manualPath = argv[++i];
      manualPathExplicit = true;
    } else if (arg === "--card-id") {
      if (i + 1 >= argv.length || argv[i + 1].startsWith("--")) {
        console.error("Error: --card-id requires an ID value");
        process.exit(EXIT_USAGE);
      }
      options.cardId = argv[++i];
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(EXIT_SUCCESS);
    } else {
      console.error(`Unknown option: ${arg}`);
      process.exit(EXIT_USAGE);
    }
  }

  if (
    manualPathExplicit &&
    !options.renderOnly &&
    path.resolve(options.manualPath) !== path.resolve(SOURCE_MANUAL_PATH)
  ) {
    console.error("Error: --manual-path may override the canonical source only in --render-only mode");
    process.exit(EXIT_USAGE);
  }

  // Validate combinations
  if (options.renderOnly) {
    if (options.apply || options.check || options.initializeMarkers || options.yes) {
      console.error("Error: --render-only cannot be combined with --apply, --check, --initialize-markers, or --yes");
      process.exit(EXIT_USAGE);
    }
    options.mode = "render-only";
    return options;
  }

  if (options.check) {
    if (options.apply || options.initializeMarkers || options.yes) {
      console.error("Error: --check cannot be combined with --apply, --initialize-markers, or --yes");
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
  --manual-path <path>              Override input only for --render-only; live-card modes require canonical MANUAL.md
  --card-id <id>                    Override target Card ID (must match expected identity)
`);
}

// ---------------------------------------------------------------------------
// Inline & Markdown to ProseMirror Parser
// ---------------------------------------------------------------------------

export function parseInline(text) {
  if (!text) return [];

  // Step 1: Extract code spans first so their contents are completely protected
  const codePlaceholders = [];
  const protectedText = text.replace(/`([^`]+)`/g, (match, codeContent) => {
    const placeholder = `\x00CODE_${codePlaceholders.length}\x00`;
    codePlaceholders.push({
      type: "text",
      text: codeContent,
      marks: [{ type: "code" }]
    });
    return placeholder;
  });

  // Helper to parse links, bold, italics, plain text
  function parseSegment(input, inheritedMarks = []) {
    const tokens = [];
    // Link: [text](url)
    // Strong: **text**
    // Italic with *: *text* (word boundary or punctuation)
    // Italic with _: (?<![a-zA-Z0-9])_(?!\s)(.+?)(?<!\s)_(?![a-zA-Z0-9]) (intra-word \w_\w is preserved)
    const regex = /(\[([^\]]+)\]\(([^)]+)\))|(\*\*([^*]+)\*\*)|((?<!\*)\*(?!\*)([^*]+)(?<!\*)\*(?!\*))|((?<![a-zA-Z0-9])_(?!\s)(.+?)(?<!\s)_(?![a-zA-Z0-9]))/g;
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(input)) !== null) {
      if (match.index > lastIndex) {
        const rawSlice = input.slice(lastIndex, match.index);
        tokens.push(...resolvePlaceholders(rawSlice, inheritedMarks));
      }

      if (match[1]) {
        // Link: [text](url)
        const linkText = match[2];
        const href = match[3];
        const linkMark = { type: "link", attrs: { href } };
        tokens.push(...resolvePlaceholders(linkText, [...inheritedMarks, linkMark]));
      } else if (match[4]) {
        // Strong: **text**
        const strongText = match[5];
        const strongMark = { type: "strong" };
        tokens.push(...parseSegment(strongText, [...inheritedMarks, strongMark]));
      } else if (match[6]) {
        // Italic with *: *text*
        const emText = match[7];
        const emMark = { type: "em" };
        tokens.push(...parseSegment(emText, [...inheritedMarks, emMark]));
      } else if (match[8]) {
        // Italic with _: _text_
        const emText = match[9];
        const emMark = { type: "em" };
        tokens.push(...parseSegment(emText, [...inheritedMarks, emMark]));
      }

      lastIndex = regex.lastIndex;
    }

    if (lastIndex < input.length) {
      const rawSlice = input.slice(lastIndex);
      tokens.push(...resolvePlaceholders(rawSlice, inheritedMarks));
    }

    return tokens;
  }

  function resolvePlaceholders(str, marks = []) {
    if (!str) return [];
    const parts = str.split(/(\x00CODE_\d+\x00)/);
    const result = [];
    for (const part of parts) {
      const codeMatch = part.match(/^\x00CODE_(\d+)\x00$/);
      if (codeMatch) {
        const idx = parseInt(codeMatch[1], 10);
        const node = codePlaceholders[idx];
        // In ProseMirror, code mark is exclusive
        result.push({
          type: "text",
          text: node.text,
          marks: [{ type: "code" }]
        });
      } else if (part.length > 0) {
        const token = { type: "text", text: part };
        if (marks && marks.length > 0) {
          token.marks = marks;
        }
        result.push(token);
      }
    }
    return result;
  }

  const rawTokens = parseSegment(protectedText);

  // Merge adjacent plain text tokens with identical marks
  const mergedTokens = [];
  for (const token of rawTokens) {
    if (mergedTokens.length === 0) {
      mergedTokens.push(token);
      continue;
    }
    const prev = mergedTokens[mergedTokens.length - 1];
    const prevMarks = JSON.stringify(prev.marks || []);
    const currMarks = JSON.stringify(token.marks || []);
    if (prevMarks === currMarks) {
      prev.text += token.text;
    } else {
      mergedTokens.push(token);
    }
  }

  return mergedTokens;
}

export function assertSupportedMarkdownSyntax(markdown) {
  let inFence = false;

  for (const line of markdown.replace(/\r\n/g, "\n").split("\n")) {
    if (line.includes(START_SENTINEL) || line.includes(END_SENTINEL)) {
      throw new Error("Unsupported Markdown syntax: reserved sync sentinel");
    }
    if (line.trim().startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const unescapedBackticks = [...line.matchAll(/(?<!\\)`/g)].length;
    if (unescapedBackticks % 2 !== 0) {
      throw new Error("Unsupported Markdown syntax: unclosed inline code");
    }

    const outsideCode = line.replace(/(?<!\\)`[^`]*?(?<!\\)`/g, "");
    if (/!\[[^\]]*\]\([^)]+\)/.test(outsideCode)) {
      throw new Error("Unsupported Markdown syntax: image");
    }
    if (outsideCode.includes("~~")) {
      throw new Error("Unsupported Markdown syntax: strikethrough");
    }
  }
}

export function markdownToProseMirror(markdown) {
  assertSupportedMarkdownSyntax(markdown);
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

export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidMarkerAttrs(attrs) {
  if (!attrs || Object.keys(attrs).length === 0) return true;
  const keys = Object.keys(attrs);
  if (keys.length === 1 && keys[0] === "id") {
    return typeof attrs.id === "string" && UUID_REGEX.test(attrs.id);
  }
  return false;
}

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
  const invalidMarkers = [];

  for (let idx = 0; idx < contentNodes.length; idx++) {
    const node = contentNodes[idx];
    const isStart = isSentinelNode(node, START_SENTINEL);
    const isEnd = isSentinelNode(node, END_SENTINEL);

    if (isStart) {
      if (!isValidMarkerAttrs(node.attrs)) {
        invalidMarkers.push({
          idx,
          reason: `Invalid marker attributes on sentinel node at index ${idx}: only optional server UUID 'attrs.id' is allowed; found ${JSON.stringify(node.attrs)}`
        });
      }
      startIndices.push(idx);
    } else if (isEnd) {
      if (!isValidMarkerAttrs(node.attrs)) {
        invalidMarkers.push({
          idx,
          reason: `Invalid marker attributes on sentinel node at index ${idx}: only optional server UUID 'attrs.id' is allowed; found ${JSON.stringify(node.attrs)}`
        });
      }
      endIndices.push(idx);
    }
  }

  const countSentinelText = (value, sentinel) => {
    if (Array.isArray(value)) {
      return value.reduce((count, item) => count + countSentinelText(item, sentinel), 0);
    }
    if (!value || typeof value !== "object") return 0;
    const own = value.type === "text" && value.text === sentinel ? 1 : 0;
    return own + Object.values(value).reduce((count, item) => count + countSentinelText(item, sentinel), 0);
  };

  const startOccurrences = countSentinelText(contentNodes, START_SENTINEL);
  const endOccurrences = countSentinelText(contentNodes, END_SENTINEL);
  if (startOccurrences !== startIndices.length) {
    invalidMarkers.push({ reason: "Nested or malformed start sentinel detected" });
  }
  if (endOccurrences !== endIndices.length) {
    invalidMarkers.push({ reason: "Nested or malformed end sentinel detected" });
  }

  return { startIndices, endIndices, invalidMarkers };
}

export function validateMarkers(contentNodes, mode) {
  const { startIndices, endIndices, invalidMarkers } = findMarkers(contentNodes);

  if (invalidMarkers.length > 0) {
    return {
      valid: false,
      reason: invalidMarkers[0].reason
    };
  }

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

export function normalizeManagedNodeIds(node) {
  if (Array.isArray(node)) return node.map(normalizeManagedNodeIds);
  if (!node || typeof node !== "object") return node;
  const copy = {};
  const keys = Object.keys(node).sort();
  for (const key of keys) {
    if (key === "attrs" && node.attrs && typeof node.attrs === "object") {
      const { id, ...restAttrs } = node.attrs;
      if (id !== undefined && (typeof id !== "string" || !UUID_REGEX.test(id))) {
        copy.attrs = normalizeManagedNodeIds(node.attrs);
      } else if (Object.keys(restAttrs).length > 0) {
        copy.attrs = normalizeManagedNodeIds(restAttrs);
      }
    } else {
      copy[key] = normalizeManagedNodeIds(node[key]);
    }
  }
  return copy;
}

export function areManagedNodesEqual(nodesA, nodesB) {
  return JSON.stringify(normalizeManagedNodeIds(nodesA)) === JSON.stringify(normalizeManagedNodeIds(nodesB));
}

export function areNodesEqual(nodesA, nodesB) {
  return areManagedNodesEqual(nodesA, nodesB);
}

// ---------------------------------------------------------------------------
// Backup Management
// ---------------------------------------------------------------------------

export function createBackup(cardId, contentMd5, rawReadPayload) {
  const cardBackupDir = path.join(BACKUP_ROOT, cardId);
  fs.mkdirSync(cardBackupDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(cardBackupDir, 0o700);
  if ((fs.statSync(cardBackupDir).mode & 0o777) !== 0o700) {
    throw new Error("Backup directory permissions must be 0700");
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFileName = `${timestamp}-${contentMd5}.json`;
  const backupFilePath = path.join(cardBackupDir, backupFileName);
  const tmpBackupPath = path.join(cardBackupDir, `.${backupFileName}.tmp-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`);

  const payloadStr = typeof rawReadPayload === "string" ? rawReadPayload : JSON.stringify(rawReadPayload, null, 2);

  try {
    fs.writeFileSync(tmpBackupPath, payloadStr, { encoding: "utf-8", mode: 0o600 });
    fs.renameSync(tmpBackupPath, backupFilePath);
  } catch (err) {
    if (fs.existsSync(tmpBackupPath)) {
      try { fs.unlinkSync(tmpBackupPath); } catch {}
    }
    throw err;
  }

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

export function runLocalCommand(command, args, timeoutMs = 30000) {
  try {
    const result = spawnSync(command, args, {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
      timeout: timeoutMs,
      env: process.env,
    });
    if (result.error) {
      return {
        status: result.error.code === "ETIMEDOUT" ? 124 : EXIT_SAFETY_GATE,
        stdout: result.stdout || "",
        stderr: result.error.code === "ETIMEDOUT" ? "Timeout" : String(result.error),
      };
    }
    return {
      status: result.status,
      stdout: result.stdout || "",
      stderr: result.stderr || "",
    };
  } catch (error) {
    return { status: EXIT_SAFETY_GATE, stdout: "", stderr: String(error) };
  }
}

export function runSourceGates(commandRunner = runLocalCommand) {
  const gates = [
    {
      name: "system-json",
      command: process.execPath,
      args: [SYSTEM_VERIFIER_PATH],
    },
    {
      name: "manual-check",
      command: "python3",
      args: [MANUAL_SYNC_SCRIPT_PATH, "--check"],
    },
  ];

  for (const gate of gates) {
    const result = commandRunner(gate.command, gate.args, 30000);
    if (!result || result.status !== 0) {
      return {
        success: false,
        exitCode: EXIT_SAFETY_GATE,
        gate: gate.name,
        error: `${gate.name} source gate failed`,
      };
    }
  }

  return { success: true };
}

export function verifyCliVersion(cliRunner = runCli) {
  const result = cliRunner(["--version"], 5000);
  if (!result || result.status !== 0) {
    const stderr = result?.stderr || "";
    const isOffline = result?.status === EXIT_OFFLINE || result?.status === 126 || /ECONNREFUSED|offline|connect|ENOENT/i.test(stderr);
    return {
      success: false,
      exitCode: isOffline ? EXIT_OFFLINE : EXIT_SAFETY_GATE,
      error: "Unable to verify Heptabase CLI version",
    };
  }

  const match = result.stdout.trim().match(/(?:^|\s)(\d+\.\d+\.\d+)(?:\s|$)/);
  if (!match || match[1] !== SUPPORTED_CLI_VERSION) {
    return {
      success: false,
      exitCode: EXIT_SAFETY_GATE,
      error: `Unsupported Heptabase CLI version; expected ${SUPPORTED_CLI_VERSION}`,
    };
  }
  return { success: true, version: match[1] };
}

const MD5_REGEX = /^[0-9a-f]{32}$/i;
const STALE_MD5_CONFLICT_REGEX = /^Error: Note content MD5 mismatch\. Conflict detected\. Stale content-md5: expected ([0-9a-f]{32}), got ([0-9a-f]{32})\s*$/i;

export function validateTargetCard(card, { previousMd5 = null, requireChangedMd5 = false } = {}) {
  if (!card || card.id !== TARGET_CARD_ID) {
    return { valid: false, reason: "Target Card ID mismatch" };
  }
  if (card.title !== EXPECTED_TITLE) {
    return { valid: false, reason: "Target title mismatch" };
  }
  if (typeof card.contentMd5 !== "string" || !MD5_REGEX.test(card.contentMd5)) {
    return { valid: false, reason: "Target contentMd5 is missing or malformed" };
  }
  if (requireChangedMd5 && card.contentMd5 === previousMd5) {
    return { valid: false, reason: "Target contentMd5 did not change after save" };
  }
  return { valid: true };
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
      if (STALE_MD5_CONFLICT_REGEX.test(res.stderr.trim())) {
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

  if (options.mode === "apply" || options.mode === "initialize") {
    const sourceGate = runSourceGates();
    if (!sourceGate.success) {
      console.error(`Safety gate error: ${sourceGate.error}`);
      return sourceGate.exitCode;
    }
  }

  const cliVersionGate = verifyCliVersion();
  if (!cliVersionGate.success) {
    console.error(`Safety gate error: ${cliVersionGate.error}`);
    return cliVersionGate.exitCode;
  }

  // 2. Read live card
  const readRes = readNote(options.cardId);
  if (!readRes.success) {
    console.error(`Read error: ${readRes.error}`);
    return readRes.exitCode;
  }

  const card = readRes.card;

  // 3. Identity Verification
  const targetCheck = validateTargetCard(card);
  if (!targetCheck.valid) {
    console.error(`Safety gate error: ${targetCheck.reason}`);
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
    const result = {
      mode: "check",
      synced: !hasChange,
      hasChange,
      target: {
        id: card.id,
        title: card.title,
        contentMd5: card.contentMd5,
      },
    };
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      if (hasChange) {
        console.log("Drift detected: Heptabase card managed region is out of sync with local MANUAL.md");
      } else {
        console.log("Heptabase card is in sync with local MANUAL.md");
      }
    }
    return hasChange ? EXIT_DRIFT : EXIT_SUCCESS;
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

  // Pre/post boundaries for comparison
  const preOriginal = options.mode === "initialize" ? currentDoc.content : currentDoc.content.slice(0, markerCheck.startIndex);
  const postOriginal = options.mode === "initialize" ? [] : currentDoc.content.slice(markerCheck.endIndex + 1);
  const originalStartMarker = options.mode === "initialize" ? null : currentDoc.content[markerCheck.startIndex];
  const originalEndMarker = options.mode === "initialize" ? null : currentDoc.content[markerCheck.endIndex];

  // B. Save
  const saveRes = saveNote(card.id, card.contentMd5, newDoc);
  if (!saveRes.success) {
    console.error(`Save failed: ${saveRes.error}`);
    // Reconciliation if indeterminate
    if (saveRes.exitCode === EXIT_INDETERMINATE) {
      const recon = readNote(card.id);
      if (recon.success) {
        const reconTarget = validateTargetCard(recon.card);
        if (!reconTarget.valid) return EXIT_INDETERMINATE;
        try {
          const reconDoc = typeof recon.card.content === "string" ? JSON.parse(recon.card.content) : recon.card.content;
          if (reconDoc?.type === "doc" && Array.isArray(reconDoc.content)) {
            if (recon.card.contentMd5 === card.contentMd5) {
              if (isDeepStrictEqual(currentDoc, reconDoc)) {
                console.log("Reconciliation: Save confirmed not applied.");
                return EXIT_OFFLINE;
              }
              console.error("Reconciliation: MD5 remained unchanged but AST changed; state is indeterminate.");
              return EXIT_INDETERMINATE;
            }
            const reconMarkerCheck = validateMarkers(reconDoc.content, "apply");
            if (reconMarkerCheck.valid) {
              const reconPre = reconDoc.content.slice(0, reconMarkerCheck.startIndex);
              const reconPost = reconDoc.content.slice(reconMarkerCheck.endIndex + 1);
              const reconManaged = reconDoc.content.slice(reconMarkerCheck.startIndex + 1, reconMarkerCheck.endIndex);
              const markersMatch = options.mode === "initialize" || (
                isDeepStrictEqual(originalStartMarker, reconDoc.content[reconMarkerCheck.startIndex]) &&
                isDeepStrictEqual(originalEndMarker, reconDoc.content[reconMarkerCheck.endIndex])
              );
              if (
                markersMatch &&
                isDeepStrictEqual(preOriginal, reconPre) &&
                isDeepStrictEqual(postOriginal, reconPost) &&
                areManagedNodesEqual(reconManaged, managedNodes)
              ) {
                console.log("Reconciliation: Save was confirmed applied.");
                return EXIT_SUCCESS;
              }
            }
          }
        } catch {}
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

  const postTargetCheck = validateTargetCard(postRead.card, {
    previousMd5: card.contentMd5,
    requireChangedMd5: true,
  });
  if (!postTargetCheck.valid) {
    console.error(`Post-fetch verification failed: ${postTargetCheck.reason}`);
    return EXIT_INDETERMINATE;
  }

  let postDoc;
  try {
    postDoc = typeof postRead.card.content === "string" ? JSON.parse(postRead.card.content) : postRead.card.content;
  } catch {
    console.error("Post-fetch verification failed: returned content is malformed");
    return EXIT_INDETERMINATE;
  }
  if (!postDoc || postDoc.type !== "doc" || !Array.isArray(postDoc.content)) {
    console.error("Post-fetch verification failed: returned content is not a valid ProseMirror doc");
    return EXIT_INDETERMINATE;
  }

  const postMarkerCheck = validateMarkers(postDoc.content, "apply");
  if (!postMarkerCheck.valid) {
    console.error(`Post-fetch verification failed on markers: ${postMarkerCheck.reason}`);
    return EXIT_INDETERMINATE;
  }

  if (options.mode !== "initialize") {
    if (
      !isDeepStrictEqual(originalStartMarker, postDoc.content[postMarkerCheck.startIndex]) ||
      !isDeepStrictEqual(originalEndMarker, postDoc.content[postMarkerCheck.endIndex])
    ) {
      console.error("Post-fetch verification failed: Routine marker nodes changed.");
      return EXIT_INDETERMINATE;
    }
  }

  // Pre-marker outside AST: 100% deep strict equality preserving all original IDs
  const prePost = postDoc.content.slice(0, postMarkerCheck.startIndex);
  if (!isDeepStrictEqual(preOriginal, prePost)) {
    console.error("Post-fetch verification failed: Pre-marker outside AST or node IDs were modified.");
    return EXIT_INDETERMINATE;
  }

  // Post-marker outside AST: 100% deep strict equality preserving all original IDs
  const postPost = postDoc.content.slice(postMarkerCheck.endIndex + 1);
  if (!isDeepStrictEqual(postOriginal, postPost)) {
    console.error("Post-fetch verification failed: Post-marker outside AST or node IDs were modified.");
    return EXIT_INDETERMINATE;
  }

  // Managed segment: compare newly rendered managedNodes with postDoc managed segment (normalized server UUIDs)
  const postManaged = postDoc.content.slice(postMarkerCheck.startIndex + 1, postMarkerCheck.endIndex);
  if (!areManagedNodesEqual(postManaged, managedNodes)) {
    console.error("Post-fetch verification failed: Managed AST content does not match expected state.");
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
