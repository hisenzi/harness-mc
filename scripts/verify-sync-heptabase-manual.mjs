#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  TARGET_CARD_ID,
  EXPECTED_TITLE,
  START_SENTINEL,
  END_SENTINEL,
  SOURCE_MANUAL_PATH,
  parseInline,
  markdownToProseMirror,
  isSentinelNode,
  findMarkers,
  validateMarkers,
  replaceManagedNodes,
  initializeMarkers,
  areNodesEqual,
  createBackup,
  saveNote,
  BACKUP_ROOT,
  EXIT_SUCCESS,
  EXIT_DRIFT,
  EXIT_SAFETY_GATE,
  EXIT_CONFLICT,
  EXIT_OFFLINE,
  EXIT_INDETERMINATE,
  EXIT_USAGE,
} from "./sync-heptabase-manual.mjs";
import * as syncModule from "./sync-heptabase-manual.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const fixturesDir = path.join(__dirname, "fixtures", "heptabase-manual");
const mockCliPath = path.join(fixturesDir, "mock-heptabase.mjs");
const scriptPath = path.join(__dirname, "sync-heptabase-manual.mjs");
const testBackupDir = fs.mkdtempSync(path.join(os.tmpdir(), "heptabase-sync-backup-test-"));

function runScript(args, env = {}) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
    env: {
      ...process.env,
      HEPTABASE_CLI_BIN: mockCliPath,
      HEPTABASE_BACKUP_DIR: testBackupDir,
      ...env,
    },
  });
}

function readCallLedger(ledgerPath) {
  if (!fs.existsSync(ledgerPath)) return [];
  return fs.readFileSync(ledgerPath, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function countLedgerCalls(calls, command, subCommand = null) {
  return calls.filter(({ args }) => (
    args[0] === command && (subCommand === null || args[1] === subCommand)
  )).length;
}

function runTests() {
  console.log("Running verify-sync-heptabase-manual test suite...\n");

  test_markdown_parser_and_extract_system_status();
  test_deterministic_rendering();
  test_render_only_mode();
  test_flags_usage_errors();
  test_target_identity_gate();
  test_source_and_cli_preflight_gates();
  test_marker_contract_and_ast_preservation();
  test_semantic_fidelity_golden_assertions();
  test_initialization_boundary();
  test_dry_run_mode();
  test_drift_check_mode();
  test_check_json_mode();
  test_backup_and_optimistic_concurrency();
  test_md5_concurrency_conflict_fail_closed();
  test_post_fetch_contract();
  test_offline_fallback();
  test_no_reverse_write();

  console.log("\nAll verify-sync-heptabase-manual tests passed successfully! (17/17)");
}

// ---------------------------------------------------------------------------
// Test 1: Parser and System Status Extraction (A03)
// ---------------------------------------------------------------------------
function test_markdown_parser_and_extract_system_status() {
  console.log("1. Testing markdown parser & system status extraction (A03)...");
  assert.ok(fs.existsSync(SOURCE_MANUAL_PATH), "MANUAL.md must exist");
  const manualRaw = fs.readFileSync(SOURCE_MANUAL_PATH, "utf-8");
  const nodes = markdownToProseMirror(manualRaw);

  assert.ok(nodes.length > 20, "Should produce multiple ProseMirror nodes");
  const types = new Set(nodes.map((n) => n.type));
  assert.ok(types.has("heading"), "Should parse headings");
  assert.ok(types.has("paragraph"), "Should parse paragraphs");
  assert.ok(types.has("table"), "Should parse tables");
  assert.ok(types.has("bullet_list_item"), "Should parse bullet list items");
  assert.ok(types.has("numbered_list_item"), "Should parse numbered list items");

  // Ensure 8 control markers are stripped
  const jsonStr = JSON.stringify(nodes);
  assert.ok(!jsonStr.includes("<!-- current-system-map:start -->"), "Stripped control marker");
  assert.ok(!jsonStr.includes("<!-- current-system-map:end -->"), "Stripped control marker");
  assert.ok(!jsonStr.includes("<!-- agent-routing:start -->"), "Stripped control marker");
  assert.ok(!jsonStr.includes("<!-- agent-routing:end -->"), "Stripped control marker");
  assert.ok(!jsonStr.includes("<!-- open-loops:start -->"), "Stripped control marker");
  assert.ok(!jsonStr.includes("<!-- open-loops:end -->"), "Stripped control marker");
  assert.ok(!jsonStr.includes("<!-- next-anchors:start -->"), "Stripped control marker");
  assert.ok(!jsonStr.includes("<!-- next-anchors:end -->"), "Stripped control marker");

  // Verify all 4 sections exist in content
  assert.ok(jsonStr.includes("Current System Map"), "Includes Current System Map");
  assert.ok(jsonStr.includes("Agent Routing"), "Includes Agent Routing");
  assert.ok(jsonStr.includes("Open Loops"), "Includes Open Loops");
  assert.ok(jsonStr.includes("Next Anchors"), "Includes Next Anchors");
  console.log("   ✓ Extracted all 4 system status sections and stripped control markers");
}

// ---------------------------------------------------------------------------
// Test 2: Deterministic Rendering (A04)
// ---------------------------------------------------------------------------
function test_deterministic_rendering() {
  console.log("2. Testing deterministic rendering (A04)...");
  const manualRaw = fs.readFileSync(SOURCE_MANUAL_PATH, "utf-8");
  const render1 = markdownToProseMirror(manualRaw);
  const render2 = markdownToProseMirror(manualRaw);

  assert.deepEqual(render1, render2, "Two successive renders must be deeply equal");
  const hash1 = crypto.createHash("sha256").update(JSON.stringify(render1)).digest("hex");
  const hash2 = crypto.createHash("sha256").update(JSON.stringify(render2)).digest("hex");
  assert.equal(hash1, hash2, "Rendered hashes must be strictly identical");
  console.log("   ✓ Deterministic rendering verified (hashes match)");
}

// ---------------------------------------------------------------------------
// Test 3: Render-only Mode (A05)
// ---------------------------------------------------------------------------
function test_render_only_mode() {
  console.log("3. Testing --render-only mode (A05)...");
  const ledgerPath = path.join(os.tmpdir(), `render-only-ledger-${Date.now()}.jsonl`);
  try {
    const res = runScript(["--render-only", "--json"], { MOCK_CALL_LEDGER: ledgerPath });
    assert.equal(res.status, EXIT_SUCCESS, "Render-only must exit 0");
    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.mode, "render-only");
    assert.ok(parsed.nodeCount > 0);
    assert.ok(parsed.fingerprint);
    assert.deepEqual(readCallLedger(ledgerPath), [], "Render-only must make zero CLI calls");
  } finally {
    if (fs.existsSync(ledgerPath)) fs.unlinkSync(ledgerPath);
  }
  console.log("   ✓ --render-only works offline with zero live calls");
}

// ---------------------------------------------------------------------------
// Test 4: Flags & Usage Errors (A05)
// ---------------------------------------------------------------------------
function test_flags_usage_errors() {
  console.log("4. Testing flag safety & usage errors (A05)...");
  // --apply without --yes
  let res = runScript(["--apply"]);
  assert.equal(res.status, EXIT_USAGE, "--apply without --yes must exit 64");

  // --yes without --apply
  res = runScript(["--yes"]);
  assert.equal(res.status, EXIT_USAGE, "--yes without --apply must exit 64");

  res = runScript(["--render-only", "--yes"]);
  assert.equal(res.status, EXIT_USAGE, "--yes must not be accepted by render-only mode");

  res = runScript(["--check", "--yes"]);
  assert.equal(res.status, EXIT_USAGE, "--yes must not be accepted by check mode");

  // --initialize-markers without --apply --yes
  res = runScript(["--initialize-markers"]);
  assert.equal(res.status, EXIT_USAGE, "--initialize-markers without --apply --yes must exit 64");

  // conflicting flags
  res = runScript(["--render-only", "--apply", "--yes"]);
  assert.equal(res.status, EXIT_USAGE, "Conflicting flags must exit 64");

  res = runScript(["--dry-run", "--apply", "--yes"]);
  assert.equal(res.status, EXIT_USAGE, "Explicit dry-run and apply must conflict with exit 64");

  res = runScript(["--apply", "--apply", "--yes"]);
  assert.equal(res.status, EXIT_USAGE, "Repeated apply mode must exit 64");

  res = runScript(["--dry-run", "--dry-run"]);
  assert.equal(res.status, EXIT_USAGE, "Repeated dry-run mode must exit 64");

  const untrustedManual = path.join(os.tmpdir(), `untrusted-manual-${Date.now()}.md`);
  const untrustedTarget = path.join(os.tmpdir(), `untrusted-manual-card-${Date.now()}.json`);
  const ledgerPath = path.join(os.tmpdir(), `untrusted-manual-ledger-${Date.now()}.jsonl`);
  fs.writeFileSync(untrustedManual, "# Untrusted live payload\n", "utf-8");
  fs.copyFileSync(path.join(fixturesDir, "drifted-card.json"), untrustedTarget);
  try {
    res = runScript(["--manual-path", untrustedManual, "--apply", "--yes"], {
      MOCK_CARD_FILE: untrustedTarget,
      MOCK_CALL_LEDGER: ledgerPath,
    });
    assert.equal(res.status, EXIT_USAGE, "Non-canonical manual path must not enter a live-card mode");
    assert.deepEqual(readCallLedger(ledgerPath), [], "Rejected manual override must make zero CLI calls");
  } finally {
    if (fs.existsSync(untrustedManual)) fs.unlinkSync(untrustedManual);
    if (fs.existsSync(untrustedTarget)) fs.unlinkSync(untrustedTarget);
    if (fs.existsSync(ledgerPath)) fs.unlinkSync(ledgerPath);
  }

  // unknown flag
  res = runScript(["--invalid-unknown-flag"]);
  assert.equal(res.status, EXIT_USAGE, "Unknown flag must exit 64");
  console.log("   ✓ Usage safety gates enforced (exit 64)");
}

// ---------------------------------------------------------------------------
// Test 5: Target Identity Gate (A06)
// ---------------------------------------------------------------------------
function test_target_identity_gate() {
  console.log("5. Testing target identity gate (A06)...");
  // Wrong Card ID
  let res = runScript(["--dry-run"], {
    MOCK_CARD_FILE: path.join(fixturesDir, "invalid-target-id.json"),
  });
  assert.equal(res.status, EXIT_SAFETY_GATE, "Wrong card ID must fail closed with exit 2");

  // Wrong Title
  res = runScript(["--dry-run"], {
    MOCK_CARD_FILE: path.join(fixturesDir, "invalid-target-title.json"),
  });
  assert.equal(res.status, EXIT_SAFETY_GATE, "Wrong title must fail closed with exit 2");

  // Corrupted non-doc AST
  res = runScript(["--dry-run"], {
    MOCK_CARD_FILE: path.join(fixturesDir, "invalid-schema-non-doc.json"),
  });
  assert.equal(res.status, EXIT_SAFETY_GATE, "Non-doc AST must fail closed with exit 2");
  console.log("   ✓ Target identity mismatches fail closed (exit 2)");
}

// ---------------------------------------------------------------------------
// Test: Source and CLI preflight gates
// ---------------------------------------------------------------------------
function test_source_and_cli_preflight_gates() {
  console.log("5b. Testing source parity and CLI version preflight gates...");

  assert.equal(typeof syncModule.runSourceGates, "function", "Adapter must expose its source-gate runner for deterministic failure-path verification");
  assert.equal(typeof syncModule.verifyCliVersion, "function", "Adapter must expose its CLI-version gate for deterministic verification");

  let calls = 0;
  let sourceResult = syncModule.runSourceGates(() => {
    calls += 1;
    return { status: calls === 1 ? 1 : 0, stdout: "", stderr: "fixture system verifier failure" };
  });
  assert.equal(sourceResult.success, false);
  assert.equal(sourceResult.exitCode, EXIT_SAFETY_GATE);
  assert.equal(sourceResult.gate, "system-json");
  assert.equal(calls, 1, "MANUAL gate must not run after system verifier failure");

  calls = 0;
  sourceResult = syncModule.runSourceGates(() => {
    calls += 1;
    return calls === 1
      ? { status: 0, stdout: "verification OK", stderr: "" }
      : { status: 1, stdout: "", stderr: "fixture MANUAL drift" };
  });
  assert.equal(sourceResult.success, false);
  assert.equal(sourceResult.exitCode, EXIT_SAFETY_GATE);
  assert.equal(sourceResult.gate, "manual-check");
  assert.equal(calls, 2);

  const goodVersion = syncModule.verifyCliVersion(() => ({ status: 0, stdout: "heptabase 0.6.0\n", stderr: "" }));
  assert.equal(goodVersion.success, true);
  const badVersion = syncModule.verifyCliVersion(() => ({ status: 0, stdout: "heptabase 0.7.0\n", stderr: "" }));
  assert.equal(badVersion.success, false);
  assert.equal(badVersion.exitCode, EXIT_SAFETY_GATE);

  const missingCli = syncModule.verifyCliVersion(() => ({ status: EXIT_OFFLINE, stdout: "", stderr: "spawnSync heptabase ENOENT" }));
  assert.equal(missingCli.success, false);
  assert.equal(missingCli.exitCode, EXIT_OFFLINE, "Missing CLI must retain the offline exit-4 contract");

  const liveModeWrongVersion = runScript(["--dry-run"], {
    MOCK_CARD_FILE: path.join(fixturesDir, "initialized-card-with-user-notes.json"),
    MOCK_CLI_VERSION: "0.7.0",
  });
  assert.equal(liveModeWrongVersion.status, EXIT_SAFETY_GATE, "Every live-card mode must reject unsupported CLI versions before card read");

  console.log("   ✓ Source failures and unsupported CLI versions fail closed before live operations");
}

// ---------------------------------------------------------------------------
// Test 6: Marker Contract & Outside AST Preservation (A07, A09)
// ---------------------------------------------------------------------------
function test_marker_contract_and_ast_preservation() {
  console.log("6. Testing marker contract & outside AST preservation (A07, A09)...");
  // Missing start
  let res = runScript(["--dry-run"], {
    MOCK_CARD_FILE: path.join(fixturesDir, "invalid-marker-missing-start.json"),
  });
  assert.equal(res.status, EXIT_SAFETY_GATE, "Missing start marker must exit 2");

  // Missing end
  res = runScript(["--dry-run"], {
    MOCK_CARD_FILE: path.join(fixturesDir, "invalid-marker-missing-end.json"),
  });
  assert.equal(res.status, EXIT_SAFETY_GATE, "Missing end marker must exit 2");

  // Duplicate markers
  res = runScript(["--dry-run"], {
    MOCK_CARD_FILE: path.join(fixturesDir, "invalid-marker-duplicate.json"),
  });
  assert.equal(res.status, EXIT_SAFETY_GATE, "Duplicate markers must exit 2");

  // Reversed markers
  res = runScript(["--dry-run"], {
    MOCK_CARD_FILE: path.join(fixturesDir, "invalid-marker-reversed.json"),
  });
  assert.equal(res.status, EXIT_SAFETY_GATE, "Reversed markers must exit 2");

  // Invalid marker attrs (custom or non-UUID attributes) -> fail-closed exit 2
  res = runScript(["--dry-run"], {
    MOCK_CARD_FILE: path.join(fixturesDir, "invalid-marker-attrs.json"),
  });
  assert.equal(res.status, EXIT_SAFETY_GATE, "Invalid marker attrs must fail closed with exit 2");

  res = runScript(["--dry-run"], {
    MOCK_CARD_FILE: path.join(fixturesDir, "invalid-marker-nested.json"),
  });
  assert.equal(res.status, EXIT_SAFETY_GATE, "Nested sentinel text must fail closed with exit 2");

  res = runScript(["--dry-run"], {
    MOCK_CARD_FILE: path.join(fixturesDir, "invalid-marker-malformed.json"),
  });
  assert.equal(res.status, EXIT_SAFETY_GATE, "Malformed sentinel node must fail closed with exit 2");

  assert.throws(
    () => markdownToProseMirror(`# Test manual\n\n${START_SENTINEL}`),
    /reserved sync sentinel/i,
    "Managed payload must reject reserved sync sentinels before any live write",
  );

  // Outside AST preservation unit test: strictly checks that pre and post nodes maintain all attrs.id
  const fixtureData = JSON.parse(fs.readFileSync(path.join(fixturesDir, "initialized-card-with-user-notes.json"), "utf-8"));
  const doc = JSON.parse(fixtureData.content);
  const { startIndex, endIndex } = validateMarkers(doc.content, "apply");
  const beforeSlice = doc.content.slice(0, startIndex);
  const afterSlice = doc.content.slice(endIndex + 1);

  const outsideFixtureIds = [];
  const collectIds = (value) => {
    if (Array.isArray(value)) {
      value.forEach(collectIds);
      return;
    }
    if (!value || typeof value !== "object") return;
    if (typeof value.attrs?.id === "string") outsideFixtureIds.push(value.attrs.id);
    Object.values(value).forEach(collectIds);
  };
  collectIds(beforeSlice);
  assert.ok(outsideFixtureIds.length > 4, "Sanitized outside-AST fixture must retain a deep UUID structure");
  assert.ok(
    outsideFixtureIds.every((id) => /^f0000000-0000-4000-8000-\d{12}$/.test(id)),
    "Tracked outside-AST fixture must use synthetic UUIDs, never live node identifiers",
  );

  const newManaged = [{ type: "paragraph", content: [{ type: "text", text: "New managed block" }] }];
  const updated = replaceManagedNodes(doc.content, newManaged, startIndex, endIndex);

  // Exact deep equality including all existing attrs.id
  assert.equal(JSON.stringify(updated.slice(0, startIndex)), JSON.stringify(beforeSlice), "Pre-marker nodes and IDs 100% untouched");
  assert.equal(JSON.stringify(updated.slice(startIndex + 1 + newManaged.length + 1)), JSON.stringify(afterSlice), "Post-marker notes and IDs 100% untouched");
  console.log("   ✓ Marker contract valid (A07) & outside AST 100% preserved with exact IDs (A09)");
}

// ---------------------------------------------------------------------------
// Test: Semantic Fidelity & Golden Expected AST (A15)
// ---------------------------------------------------------------------------
function test_semantic_fidelity_golden_assertions() {
  console.log("6b. Testing semantic fidelity & independent golden AST assertions (A15)...");

  // 1. generated_at: intra-word underscore must stay plain text
  const ast1 = parseInline("Freshness: generated_at `2026-09-02T08:17:24Z`; degraded `true`");
  const goldenAst1 = [
    { type: "text", text: "Freshness: generated_at " },
    { type: "text", text: "2026-09-02T08:17:24Z", marks: [{ type: "code" }] },
    { type: "text", text: "; degraded " },
    { type: "text", text: "true", marks: [{ type: "code" }] },
  ];
  assert.deepEqual(ast1, goldenAst1, "generated_at must retain intra-word underscore without italic corruption");
  const visibleText1 = ast1.map((n) => n.text).join("");
  assert.equal(visibleText1, "Freshness: generated_at 2026-09-02T08:17:24Z; degraded true");

  // 2. routing_and_decision_evidence: multiple underscores must stay plain text
  const ast2 = parseInline("Docs role: routing_and_decision_evidence");
  const goldenAst2 = [
    { type: "text", text: "Docs role: routing_and_decision_evidence" },
  ];
  assert.deepEqual(ast2, goldenAst2, "routing_and_decision_evidence must retain all underscores");
  assert.equal(ast2[0].marks, undefined);
  assert.equal(ast2[0].text, "Docs role: routing_and_decision_evidence");

  // 3. second_source_risk: underscore in prose or code must be preserved
  const ast3 = parseInline("Rule: second_source_risk applies to all visual mirrors");
  const goldenAst3 = [
    { type: "text", text: "Rule: second_source_risk applies to all visual mirrors" },
  ];
  assert.deepEqual(ast3, goldenAst3, "second_source_risk must retain underscore");
  assert.equal(ast3[0].text, "Rule: second_source_risk applies to all visual mirrors");

  // 4. Same-line outer emphasis containing generated_at: must close properly without residual '._'
  const ast4 = parseInline("_Auto-generated from morrowise-system.json; generated_at: 2026-09-05T09:12:35Z._");
  const goldenAst4 = [
    {
      type: "text",
      text: "Auto-generated from morrowise-system.json; generated_at: 2026-09-05T09:12:35Z.",
      marks: [{ type: "em" }],
    },
  ];
  assert.deepEqual(ast4, goldenAst4, "Outer emphasis must close properly across intra-word underscores");
  assert.equal(ast4[0].text, "Auto-generated from morrowise-system.json; generated_at: 2026-09-05T09:12:35Z.");
  assert.ok(!ast4.some((n) => n.text.includes("._")), "No trailing ._ artifact allowed");

  // 5. Outer emphasis with embedded code span
  const ast5 = parseInline("_Source: `$COLLAB/path/to/file.json`._");
  const goldenAst5 = [
    { type: "text", text: "Source: ", marks: [{ type: "em" }] },
    { type: "text", text: "$COLLAB/path/to/file.json", marks: [{ type: "code" }] },
    { type: "text", text: ".", marks: [{ type: "em" }] },
  ];
  assert.deepEqual(ast5, goldenAst5, "Outer emphasis with embedded code span correctly parses both");

  assert.throws(
    () => markdownToProseMirror("![alt](https://example.com/image.png)"),
    /Unsupported Markdown syntax: image/,
    "Markdown images must fail closed instead of degrading to a link"
  );
  assert.throws(
    () => markdownToProseMirror("~~deleted~~"),
    /Unsupported Markdown syntax: strikethrough/,
    "Strikethrough must fail closed while it is outside the renderer allowlist"
  );
  assert.throws(
    () => markdownToProseMirror("unclosed `inline code"),
    /Unsupported Markdown syntax: unclosed inline code/,
    "Unclosed inline code must fail closed"
  );

  console.log("   ✓ Independent Golden AST & visible-text assertions verified (A15)");
}

// ---------------------------------------------------------------------------
// Test 7: Initialization Boundary (A08)
// ---------------------------------------------------------------------------
function test_initialization_boundary() {
  console.log("7. Testing initialization boundary (A08)...");
  // Uninitialized card in routine apply must fail closed
  let res = runScript(["--apply", "--yes"], {
    MOCK_CARD_FILE: path.join(fixturesDir, "initial-card.json"),
  });
  assert.equal(res.status, EXIT_SAFETY_GATE, "Routine apply on uninitialized card must exit 2");

  // Already initialized card in initialize mode must fail closed
  res = runScript(["--initialize-markers", "--apply", "--yes"], {
    MOCK_CARD_FILE: path.join(fixturesDir, "initialized-card-with-user-notes.json"),
  });
  assert.equal(res.status, EXIT_SAFETY_GATE, "Initialize on already-initialized card must exit 2");

  // Initialize with tmp copy
  const tmpCard = path.join(os.tmpdir(), `init-test-${Date.now()}.json`);
  fs.copyFileSync(path.join(fixturesDir, "initial-card.json"), tmpCard);
  try {
    res = runScript(["--initialize-markers", "--apply", "--yes"], {
      MOCK_CARD_FILE: tmpCard,
    });
    assert.equal(res.status, EXIT_SUCCESS, "Initialize on clean card must exit 0");
    const updatedData = JSON.parse(fs.readFileSync(tmpCard, "utf-8"));
    const updatedDoc = JSON.parse(updatedData.content);
    const check = validateMarkers(updatedDoc.content, "apply");
    assert.ok(check.valid, "Initialized doc must now have valid markers");
  } finally {
    if (fs.existsSync(tmpCard)) fs.unlinkSync(tmpCard);
  }
  console.log("   ✓ Initialization boundary gates properly enforced");
}

// ---------------------------------------------------------------------------
// Test 8: Dry Run Mode (A05)
// ---------------------------------------------------------------------------
function test_dry_run_mode() {
  console.log("8. Testing dry-run mode (A05)...");
  const ledgerPath = path.join(os.tmpdir(), `dry-run-ledger-${Date.now()}.jsonl`);
  try {
    const res = runScript(["--dry-run", "--json"], {
      MOCK_CARD_FILE: path.join(fixturesDir, "initialized-card-with-user-notes.json"),
      MOCK_CALL_LEDGER: ledgerPath,
    });
    assert.equal(res.status, EXIT_SUCCESS, "Dry run must exit 0");
    const summary = JSON.parse(res.stdout);
    assert.equal(summary.mode, "dry-run");
    assert.equal(summary.saveCount, 0, "Dry run must NOT mutate card");
    const calls = readCallLedger(ledgerPath);
    assert.equal(countLedgerCalls(calls, "note", "read"), 1, "Dry run must perform exactly one live read");
    assert.equal(countLedgerCalls(calls, "note", "save"), 0, "Dry run must make zero save calls");
  } finally {
    if (fs.existsSync(ledgerPath)) fs.unlinkSync(ledgerPath);
  }
  console.log("   ✓ Dry run successfully performed without mutations");
}

// ---------------------------------------------------------------------------
// Test 9: Drift Check Mode (A05)
// ---------------------------------------------------------------------------
function test_drift_check_mode() {
  console.log("9. Testing --check drift detection (A05)...");
  // Drifted card -> exit 1
  let res = runScript(["--check"], {
    MOCK_CARD_FILE: path.join(fixturesDir, "drifted-card.json"),
  });
  assert.equal(res.status, EXIT_DRIFT, "Drifted card must return exit 1");

  // In-sync card (initialize fresh copy and check)
  const tmpCard = path.join(os.tmpdir(), `drift-check-${Date.now()}.json`);
  fs.copyFileSync(path.join(fixturesDir, "initial-card.json"), tmpCard);
  try {
    // initialize
    runScript(["--initialize-markers", "--apply", "--yes"], { MOCK_CARD_FILE: tmpCard });
    // now check: should be in sync!
    res = runScript(["--check"], { MOCK_CARD_FILE: tmpCard });
    assert.equal(res.status, EXIT_SUCCESS, "Synchronized card must return exit 0");
  } finally {
    if (fs.existsSync(tmpCard)) fs.unlinkSync(tmpCard);
  }
  console.log("   ✓ Drift check accurately distinguishes synced (exit 0) and drifted (exit 1)");
}

// ---------------------------------------------------------------------------
// Test: --check --json Output Contract (A16)
// ---------------------------------------------------------------------------
function test_check_json_mode() {
  console.log("9b. Testing --check --json output contract (A16)...");

  // Drifted card: exit 1, output valid JSON with synced: false, hasChange: true
  const driftLedgerPath = path.join(os.tmpdir(), `check-drift-ledger-${Date.now()}.jsonl`);
  const resDrift = runScript(["--check", "--json"], {
    MOCK_CARD_FILE: path.join(fixturesDir, "drifted-card.json"),
    MOCK_CALL_LEDGER: driftLedgerPath,
  });
  try {
    assert.equal(resDrift.status, EXIT_DRIFT, "--check --json on drifted card must exit 1");
    const parsedDrift = JSON.parse(resDrift.stdout);
    assert.equal(parsedDrift.mode, "check");
    assert.equal(parsedDrift.synced, false);
    assert.equal(parsedDrift.hasChange, true);
    assert.equal(parsedDrift.target.id, TARGET_CARD_ID);
    assert.equal(parsedDrift.target.title, EXPECTED_TITLE);
    assert.ok(parsedDrift.target.contentMd5);
    const calls = readCallLedger(driftLedgerPath);
    assert.equal(countLedgerCalls(calls, "note", "read"), 1, "Check must perform exactly one live read");
    assert.equal(countLedgerCalls(calls, "note", "save"), 0, "Check must make zero save calls");
  } finally {
    if (fs.existsSync(driftLedgerPath)) fs.unlinkSync(driftLedgerPath);
  }

  // Synced card: exit 0, output valid JSON with synced: true, hasChange: false
  const tmpCard = path.join(os.tmpdir(), `check-json-${Date.now()}.json`);
  fs.copyFileSync(path.join(fixturesDir, "initial-card.json"), tmpCard);
  try {
    runScript(["--initialize-markers", "--apply", "--yes"], { MOCK_CARD_FILE: tmpCard });
    const resSync = runScript(["--check", "--json"], { MOCK_CARD_FILE: tmpCard });
    assert.equal(resSync.status, EXIT_SUCCESS, "--check --json on synced card must exit 0");
    const parsedSync = JSON.parse(resSync.stdout);
    assert.equal(parsedSync.mode, "check");
    assert.equal(parsedSync.synced, true);
    assert.equal(parsedSync.hasChange, false);
    assert.equal(parsedSync.target.id, TARGET_CARD_ID);
    assert.equal(parsedSync.target.title, EXPECTED_TITLE);
    assert.ok(parsedSync.target.contentMd5);
  } finally {
    if (fs.existsSync(tmpCard)) fs.unlinkSync(tmpCard);
  }

  console.log("   ✓ --check --json contract verified for drift and synced states (A16)");
}

// ---------------------------------------------------------------------------
// Test 10: Backup & Optimistic Concurrency & Idempotency (A10, A12)
// ---------------------------------------------------------------------------
function test_backup_and_optimistic_concurrency() {
  console.log("10. Testing backup creation, apply save & idempotency (A10, A12)...");
  const tmpCard = path.join(os.tmpdir(), `apply-test-${Date.now()}.json`);
  const firstLedgerPath = path.join(os.tmpdir(), `first-apply-ledger-${Date.now()}.jsonl`);
  const secondLedgerPath = path.join(os.tmpdir(), `second-apply-ledger-${Date.now()}.jsonl`);
  fs.copyFileSync(path.join(fixturesDir, "drifted-card.json"), tmpCard);

  try {
    // First run: apply change
    const res1 = runScript(["--apply", "--yes"], {
      MOCK_CARD_FILE: tmpCard,
      MOCK_CALL_LEDGER: firstLedgerPath,
    });
    assert.equal(res1.status, EXIT_SUCCESS, "Apply must exit 0");
    assert.equal(countLedgerCalls(readCallLedger(firstLedgerPath), "note", "save"), 1, "First apply must save exactly once");

    // Verify backup was created
    const cardBackupDir = path.join(testBackupDir, TARGET_CARD_ID);
    assert.ok(fs.existsSync(cardBackupDir), "Backup directory must exist");
    const dirStat = fs.statSync(cardBackupDir);
    assert.equal(dirStat.mode & 0o777, 0o700, "Backup directory mode must be 0700");
    const backups = fs.readdirSync(cardBackupDir).filter((name) => name.endsWith(".json"));
    assert.ok(backups.length > 0, "Backup file must be written");
    assert.equal(fs.readdirSync(cardBackupDir).some((name) => name.includes(".tmp-")), false, "Atomic backup temp files must be cleaned up");

    // Check backup file permission (mode 0600 on POSIX)
    for (const backup of backups) {
      const stat = fs.statSync(path.join(cardBackupDir, backup));
      assert.equal(stat.mode & 0o777, 0o600, "Every backup file mode must be 0600");
    }

    // Second run: immediately rerun apply -> must detect no change (idempotency)
    const res2 = runScript(["--apply", "--yes"], {
      MOCK_CARD_FILE: tmpCard,
      MOCK_CALL_LEDGER: secondLedgerPath,
    });
    assert.equal(res2.status, EXIT_SUCCESS, "Second run must exit 0");
    assert.ok(res2.stdout.includes("No changes detected"), "Second run must skip save");
    assert.equal(countLedgerCalls(readCallLedger(secondLedgerPath), "note", "save"), 0, "Idempotent second apply must make zero save calls");
  } finally {
    if (fs.existsSync(tmpCard)) fs.unlinkSync(tmpCard);
    if (fs.existsSync(firstLedgerPath)) fs.unlinkSync(firstLedgerPath);
    if (fs.existsSync(secondLedgerPath)) fs.unlinkSync(secondLedgerPath);
  }
  console.log("   ✓ Backup created (mode 0600), save applied, 2nd run idempotent");
}

// ---------------------------------------------------------------------------
// Test 11: Concurrency Conflict Fail Closed (A10)
// ---------------------------------------------------------------------------
function test_md5_concurrency_conflict_fail_closed() {
  console.log("11. Testing optimistic concurrency conflict fail-closed (A10)...");
  // Direct unit test of conflict exit mapping in saveNote
  const tmpCard2 = path.join(os.tmpdir(), `conflict-direct-${Date.now()}.json`);
  const cardData2 = JSON.parse(fs.readFileSync(path.join(fixturesDir, "drifted-card.json"), "utf-8"));
  fs.writeFileSync(tmpCard2, JSON.stringify(cardData2), "utf-8");
  try {
    // Overwrite contentMd5 on disk right after read by running a mock child process
    // Or we test saveNote error mapping:
    // If CLI outputs Stale content-md5 / Conflict -> adapter returns EXIT_CONFLICT (3)
    process.env.HEPTABASE_CLI_BIN = mockCliPath;
    process.env.MOCK_CARD_FILE = tmpCard2;
    const saveRes = saveNote(TARGET_CARD_ID, "00000000000000000000000000000000", { type: "doc", content: [] });
    assert.equal(saveRes.success, false);
    assert.equal(saveRes.exitCode, EXIT_CONFLICT, "Conflict must map to exit 3");

    process.env.MOCK_CLI_MODE = "generic_mismatch";
    const genericMismatch = saveNote(TARGET_CARD_ID, cardData2.contentMd5, { type: "doc", content: [] });
    assert.equal(genericMismatch.success, false);
    assert.equal(genericMismatch.exitCode, EXIT_INDETERMINATE, "Generic mismatch text must not be classified as stale-MD5 conflict");
  } finally {
    delete process.env.MOCK_CLI_MODE;
    delete process.env.HEPTABASE_CLI_BIN;
    delete process.env.MOCK_CARD_FILE;
    if (fs.existsSync(tmpCard2)) fs.unlinkSync(tmpCard2);
  }
  console.log("   ✓ Stale MD5 concurrency conflict aborts immediately with exit 3");
}

// ---------------------------------------------------------------------------
// Test: Post-fetch identity, MD5, marker, outside-AST and malformed content
// ---------------------------------------------------------------------------
function test_post_fetch_contract() {
  console.log("11b. Testing strict post-fetch contract...");

  const cases = [
    ["marker_id_changed", EXIT_INDETERMINATE, "Changed routine marker UUID must fail post-fetch"],
    ["outside_id_changed", EXIT_INDETERMINATE, "Changed outside AST UUID must fail post-fetch"],
    ["identity_changed", EXIT_INDETERMINATE, "Changed target identity must fail post-fetch"],
    ["md5_missing", EXIT_INDETERMINATE, "Missing post-fetch MD5 must fail post-fetch"],
    ["md5_unchanged", EXIT_INDETERMINATE, "Unchanged post-fetch MD5 after a write must fail post-fetch"],
    ["malformed_content", EXIT_INDETERMINATE, "Malformed post-fetch content must map to indeterminate exit 5"],
  ];

  for (const [mode, expectedExit, message] of cases) {
    const tmpCard = path.join(os.tmpdir(), `post-fetch-${mode}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
    fs.copyFileSync(path.join(fixturesDir, "drifted-card.json"), tmpCard);
    try {
      const result = runScript(["--apply", "--yes"], {
        MOCK_CARD_FILE: tmpCard,
        MOCK_POST_READ_MODE: mode,
      });
      assert.equal(result.status, expectedExit, `${message}; stderr=${result.stderr}`);
    } finally {
      if (fs.existsSync(tmpCard)) fs.unlinkSync(tmpCard);
    }
  }

  console.log("   ✓ Post-fetch rejects marker/outside/identity/MD5/content corruption");
}

// ---------------------------------------------------------------------------
// Test 12: Offline Fallback (A11)
// ---------------------------------------------------------------------------
function test_offline_fallback() {
  console.log("12. Testing offline fallback (A11)...");
  // App offline (connection refused)
  let res = runScript(["--dry-run"], {
    MOCK_CARD_FILE: path.join(fixturesDir, "initial-card.json"),
    MOCK_CLI_MODE: "offline",
  });
  assert.equal(res.status, EXIT_OFFLINE, "Offline CLI must map to exit 4");

  // Operation not permitted (exit 126)
  res = runScript(["--dry-run"], {
    MOCK_CARD_FILE: path.join(fixturesDir, "initial-card.json"),
    MOCK_CLI_MODE: "error_126",
  });
  assert.equal(res.status, EXIT_OFFLINE, "CLI exit 126 must map to exit 4");

  const reconciliationCases = [
    ["timeout_expected", EXIT_SUCCESS, "Expected post-timeout AST must reconcile as applied"],
    ["timeout_before", EXIT_OFFLINE, "Unchanged AST and MD5 must reconcile as not applied"],
    ["timeout_neither", EXIT_INDETERMINATE, "Third-state AST must remain indeterminate"],
    ["timeout_same_md5_changed_ast", EXIT_INDETERMINATE, "Changed AST with stale MD5 must not be misclassified as not applied"],
  ];

  for (const [mode, expectedExit, message] of reconciliationCases) {
    const tmpCard = path.join(os.tmpdir(), `reconcile-${mode}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
    const ledgerPath = path.join(os.tmpdir(), `reconcile-${mode}-ledger-${Date.now()}-${Math.random().toString(16).slice(2)}.jsonl`);
    fs.copyFileSync(path.join(fixturesDir, "drifted-card.json"), tmpCard);
    try {
      const result = runScript(["--apply", "--yes"], {
        MOCK_CARD_FILE: tmpCard,
        MOCK_CLI_MODE: mode,
        MOCK_CALL_LEDGER: ledgerPath,
      });
      assert.equal(result.status, expectedExit, `${message}; stderr=${result.stderr}`);
      const calls = readCallLedger(ledgerPath);
      assert.equal(countLedgerCalls(calls, "note", "save"), 1, `${mode} must attempt exactly one save`);
      assert.equal(countLedgerCalls(calls, "note", "read"), 2, `${mode} must perform one pre-read and one bounded reconciliation read`);
    } finally {
      if (fs.existsSync(tmpCard)) fs.unlinkSync(tmpCard);
      if (fs.existsSync(ledgerPath)) fs.unlinkSync(ledgerPath);
    }
  }
  console.log("   ✓ Offline paths and bounded timeout reconciliation satisfy A11");
}

// ---------------------------------------------------------------------------
// Test 13: Zero Reverse Write (A13)
// ---------------------------------------------------------------------------
function test_no_reverse_write() {
  console.log("13. Testing zero reverse write boundary (A13)...");
  const scriptContent = fs.readFileSync(scriptPath, "utf-8");

  // Ensure script does NOT write to tasks.json or registries
  assert.ok(!scriptContent.includes("writeFileSync(TARGET_TASK"), "No tasks.json write");
  assert.ok(!scriptContent.includes("writeFileSync(SYSTEM_JSON"), "No system.json write");
  assert.ok(!scriptContent.includes("writeFileSync(SOURCE_MANUAL"), "No MANUAL.md write");

  // Check capability registry existence
  const registryPath = path.join(root, "system-workflow", "registries", "morrowise-api-cli-mcp-capability-registry.json");
  assert.ok(fs.existsSync(registryPath), "Capability registry must exist");
  console.log("   ✓ Single source of truth enforced: zero reverse write to canonical state");
}

const focusedTests = {
  modes: test_flags_usage_errors,
  "source-cli": test_source_and_cli_preflight_gates,
  marker: test_marker_contract_and_ast_preservation,
  parser: test_semantic_fidelity_golden_assertions,
  backup: test_backup_and_optimistic_concurrency,
  conflict: test_md5_concurrency_conflict_fail_closed,
  "post-fetch": test_post_fetch_contract,
  offline: test_offline_fallback,
};

try {
  const focused = process.env.VERIFY_ONLY;
  if (focused) {
    assert.ok(focusedTests[focused], `Unknown VERIFY_ONLY case: ${focused}`);
    focusedTests[focused]();
  } else {
    runTests();
  }
} finally {
  fs.rmSync(testBackupDir, { recursive: true, force: true });
}
