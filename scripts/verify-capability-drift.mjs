// Verify the MorroWise capability observed scan + drift read model (JV-19).
// Fixture models the 2026-07-05 Heptabase double-wiring: same vault reachable via
// local MCP config AND an account-layer session connector. The scan must auto-report
// the account-layer route as observed-not-declared, and must never leak env secrets.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateCapabilityObserved } from "./generate-capability-observed.mjs";
import { assertNoLeak } from "./capability-observed-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outPath = path.join(root, ".tmp", "capability-observed.verify.json");

const FAKE_TOKEN = "fc-SECRETTOKEN-should-never-appear";

// Fixture ~/.claude.json: heptabase-mcp duplicated across scopes, firecrawl with a
// secret-bearing env (must be dropped), playwright configured as an MCP server.
// NOTE: the "/Users/test" literals below are synthetic redaction-test inputs, not
// real machine paths — macOS homes are /Users/-shaped, so the fixture must use that
// shape to exercise the home-path leak guard. They are asserted absent from output.
const claudeJson = {
  mcpServers: {
    "heptabase-mcp": { type: "http", url: "https://api.heptabase.com/mcp" },
    firecrawl: {
      type: "stdio",
      command: "/Users/test/bin/firecrawl-mcp",
      args: ["--api-key", FAKE_TOKEN],
      env: { FIRECRAWL_API_KEY: FAKE_TOKEN },
    },
  },
  projects: {
    "/Users/test/Downloads/Claude_協作": {
      mcpServers: {
        "heptabase-mcp": { type: "http", url: "https://api.heptabase.com/mcp" },
        playwright: { type: "stdio", command: "npx", args: ["-y", "@anthropic-ai/mcp-playwright"] },
      },
    },
  },
};

const data = generateCapabilityObserved({
  root,
  outPath,
  generatedAt: "2026-07-06T00:00:00.000Z",
  homedir: "/Users/test",
  collabRoot: "/Users/test/Downloads/Claude_協作",
  hostname: "fixture-machine.local",
  sessionMcpServers: ["heptabase-mcp", "heptabase-account-connector"],
  inputs: {
    claudeJson,
    runtimeSourcesAvailable: true,
    cliPresence: { heptabase: true, playwright: false, gh: true, node: true },
    launchAgents: [{ name: "com.hisenzi.schedule.system-pulse.plist", program_hint: "$COLLAB/notyet-harness/schedule/dispatch.sh" }],
    hookSources: [{ source: "$COLLAB/.claude/settings.json", hook_events: ["PostToolUse"], generator_hints: ["generate-data.mjs"] }],
    secrets: [{ name: "notion.env", exists: true, mtime: "2026-05-21T00:00:00.000Z" }],
  },
});

// --- schema + boundary ---
assert.equal(data.schema_version, "capability-observed.v0");
assert.equal(data.read_only, true);
assert.ok(fs.existsSync(outPath), "capability-observed.json should be written");
assert.equal(data.task_anchor, "$COLLAB/harness-mc/milestones/morrowise/tasks.json#capability-observed-scan");
assert.ok(data.write_boundary.forbidden.includes("read MCP env / headers / token values"));
assert.ok(data.write_boundary.forbidden.includes("output home-absolute paths"));

// --- account-layer connector auto-reported as observed-not-declared ---
const accountLayer = data.drift.observed_not_declared.filter((d) => d.origin === "account_layer");
assert.ok(
  accountLayer.some((d) => /heptabase-account-connector/.test(d.observed)),
  "account-layer heptabase connector must be reported observed-not-declared",
);
assert.equal(data.drift.session_probe, "available", "session probe should be available when sessionMcpServers passed");

// --- local-config MCP servers with no declared MCP capability = drift ---
const localHeptabase = data.drift.observed_not_declared.filter(
  (d) => d.origin === "local_config" && /heptabase-mcp/.test(d.observed),
);
assert.ok(localHeptabase.length >= 1, "local heptabase-mcp must surface as observed-not-declared (registry has no live MCP route)");
assert.ok(
  data.drift.observed_not_declared.some((d) => /firecrawl/.test(d.observed)),
  "firecrawl must surface as observed-not-declared (JV-21 evidence)",
);

// --- declared capability with absent CLI footprint = declared-not-observed ---
assert.ok(
  data.drift.declared_not_observed.some((d) => d.capability_id === "playwright-cli"),
  "playwright-cli declared but CLI absent → declared-not-observed",
);
// --- heptabase CLI present → aligned ---
assert.ok(
  data.drift.aligned.some((a) => a.matched.includes("heptabase-cli-task-cards")),
  "heptabase CLI present → aligned",
);

// --- decision evidence wired for JV-20/21/22 ---
assert.ok(
  data.decision_evidence["JV-20-mcp-registration-consolidation"].some((d) => d.name === "heptabase-mcp" && d.count >= 2),
  "duplicate MCP registration must be reported for JV-20",
);
assert.ok(
  data.decision_evidence["JV-21-firecrawl-disposition"].some((s) => /firecrawl/.test(s)),
  "firecrawl disposition evidence must be present for JV-21",
);
assert.ok(
  data.decision_evidence["JV-22-account-connector-policy"].some((s) => /heptabase-account-connector/.test(s)),
  "account-layer connector evidence must be present for JV-22",
);

// --- RED LINE: env secrets and home paths must never leak ---
const serialized = JSON.stringify(data);
assert.ok(!serialized.includes(FAKE_TOKEN), "env token value must never appear in observed read model");
assert.ok(!serialized.includes("FIRECRAWL_API_KEY"), "env key names must not be copied into observed read model");
assert.ok(!serialized.includes("/Users/test"), "home-absolute paths must be redacted");
const leaks = assertNoLeak(serialized);
assert.equal(leaks.length, 0, `no unsafe content allowed, found: ${leaks.join(", ")}`);

// --- fake-live guard: CI (no runtime) must be indeterminate, not "clean" ---
const ciData = generateCapabilityObserved({
  root,
  write: false,
  generatedAt: "2026-07-06T00:00:00.000Z",
  inputs: { claudeJson: null, runtimeSourcesAvailable: false, cliPresence: {}, launchAgents: [], hookSources: [], secrets: [] },
});
assert.equal(ciData.scan_context.scan_completeness, "ci_no_runtime");
assert.ok(/must NOT be read as 'no drift'/.test(ciData.scan_context.note), "CI empty scan must warn against fake-live reading");

console.log("Capability drift verification OK");
