// Generate the MorroWise capability OBSERVED scan + drift read model (JV-19).
//
// Declared (registry) vs observed (this machine's actual wiring). Enumerates MCP
// servers across all ~/.claude.json scopes, allowlisted CLIs, launchd jobs, hooks,
// and secret-file existence — SAFE METADATA ONLY, never credential content.
//
// Output is machine-local and gitignored (like capability-runtime-status.json);
// on CI there is no local runtime, so scan_completeness marks the scan indeterminate
// instead of pretending an empty machine means "no drift" (fake-live guard).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  extractMcpServers,
  buildCliObservations,
  buildLaunchdObservations,
  buildHookObservations,
  buildSecretObservations,
  computeDrift,
  redactPaths,
  cliAllowlist,
  assertNoLeak,
} from "./capability-observed-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(__dirname, "..");
const DATA_DIR = path.join("public", "data");

export function generateCapabilityObserved(options = {}) {
  const root = options.root || defaultRoot;
  const collabRoot = options.collabRoot || path.resolve(root, "..");
  const homedir = options.homedir || os.homedir();
  const hostname = options.hostname || safeHostname();
  const generatedAt = options.generatedAt || new Date().toISOString();
  const inputs = options.inputs || {};
  const outPath = options.outPath || path.join(root, DATA_DIR, "capability-observed.json");
  const redact = (v) => redactPaths(v, { homedir, collabRoot });

  const claudeJson = inputs.claudeJson !== undefined ? inputs.claudeJson : readClaudeConfig(homedir);
  const runtimeSourcesAvailable =
    inputs.runtimeSourcesAvailable !== undefined ? inputs.runtimeSourcesAvailable : claudeJson !== null;

  const mcpServers = extractMcpServers(claudeJson, { homedir, collabRoot });
  const cliPresence = inputs.cliPresence || probeCliPresence();
  const clis = buildCliObservations(cliPresence);
  const launchAgents = buildLaunchdObservations(inputs.launchAgents || readLaunchAgents(homedir, redact));
  const hookSources = buildHookObservations(inputs.hookSources || readHooks(collabRoot, redact));
  const secrets = buildSecretObservations(inputs.secrets || readSecrets(collabRoot));
  const registry = inputs.registry || readRegistry(root);
  const sessionMcpServers = options.sessionMcpServers || null;

  const declaredProbes = buildDeclaredProbes(registry, cliPresence);

  const drift = computeDrift(
    { mcp_servers: mcpServers, session_mcp_servers: sessionMcpServers, clis },
    declaredProbes,
  );

  const scanCompleteness = runtimeSourcesAvailable
    ? sessionMcpServers
      ? "local_full_with_session_probe"
      : "local_full"
    : "ci_no_runtime";

  const data = {
    schema_version: "capability-observed.v0",
    generated_at: generatedAt,
    read_only: true,
    task_anchor: "$COLLAB/harness-mc/milestones/morrowise/tasks.json#capability-observed-scan",
    scan_context: {
      machine: hostname,
      runtime_sources_available: runtimeSourcesAvailable,
      scan_completeness: scanCompleteness,
      session_probe: drift.session_probe,
      note:
        scanCompleteness === "ci_no_runtime"
          ? "No local runtime sources (e.g. CI build). Observed layer is indeterminate; empty observed must NOT be read as 'no drift'."
          : "Observed from local runtime sources on the named machine. Snapshot is machine-local (JV-28 will make it machine-scoped and shareable).",
    },
    write_boundary: {
      allowed: [
        "read MCP server names/scopes/types from ~/.claude.json",
        "check CLI existence via command -v",
        "read launchd plist program hints",
        "read hook event names and generator script basenames",
        "check secret-file existence and mtime",
      ],
      forbidden: [
        "read MCP env / headers / token values",
        "read OAuth or API token content",
        "read secret file content",
        "output home-absolute paths",
        "execute external writes",
      ],
    },
    declared_source: {
      registry_ref: "$COLLAB/harness-mc/system-workflow/registries/morrowise-api-cli-mcp-capability-registry.json",
      declared_capability_count: Array.isArray(registry?.capabilities) ? registry.capabilities.length : 0,
    },
    observed: {
      mcp_servers: mcpServers,
      clis,
      launch_agents: launchAgents,
      hooks: hookSources,
      secrets,
    },
    drift,
    summary: {
      observed_mcp_servers: mcpServers.length,
      observed_clis_present: clis.filter((c) => c.present).length,
      observed_launch_agents: launchAgents.length,
      observed_hooks: hookSources.length,
      observed_secrets: secrets.length,
      drift_observed_not_declared: drift.observed_not_declared.length,
      drift_declared_not_observed: drift.declared_not_observed.length,
      drift_aligned: drift.aligned.length,
    },
    decision_evidence: {
      "JV-20-mcp-registration-consolidation": mcpDuplicateReport(mcpServers),
      "JV-21-firecrawl-disposition": mcpServers
        .filter((s) => /firecrawl/i.test(s.name))
        .map((s) => `${s.name}@${s.scope}`),
      "JV-22-account-connector-policy": drift.observed_not_declared
        .filter((d) => d.origin === "account_layer")
        .map((d) => d.observed),
    },
  };

  const serialized = `${JSON.stringify(data, null, 2)}\n`;
  const leaks = assertNoLeak(serialized);
  if (leaks.length > 0) {
    throw new Error(`capability-observed read model leaked unsafe content: ${leaks.join(", ")}`);
  }

  if (options.write !== false) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, serialized);
    console.log(
      `Generated ${outPath} — ${mcpServers.length} MCP, ${drift.observed_not_declared.length} observed-not-declared, ${drift.declared_not_observed.length} declared-not-observed (${scanCompleteness})`,
    );
  }

  return data;
}

function buildDeclaredProbes(registry, cliPresence = {}) {
  const capabilities = Array.isArray(registry?.capabilities) ? registry.capabilities : [];
  return capabilities.map((cap) => {
    const id = cap.id;
    if (id === "playwright-cli") {
      return { capability_id: id, kind: "cli", match_token: "playwright", present: Boolean(cliPresence.playwright) };
    }
    if (id === "heptabase-cli-task-cards") {
      return { capability_id: id, kind: "cli", match_token: "heptabase", present: Boolean(cliPresence.heptabase) };
    }
    if (cap.status === "legacy") {
      return { capability_id: id, kind: "legacy", expected_absent: true };
    }
    if (cap.type === "delivery_adapter") {
      return { capability_id: id, kind: "contract", scannable: false };
    }
    return { capability_id: id, kind: cap.type || "unknown", scannable: false };
  });
}

function mcpDuplicateReport(mcpServers) {
  const byName = {};
  for (const s of mcpServers) {
    byName[s.name] = byName[s.name] || [];
    byName[s.name].push(s.scope);
  }
  return Object.entries(byName)
    .filter(([, scopes]) => scopes.length > 1)
    .map(([name, scopes]) => ({ name, scopes, count: scopes.length }));
}

function safeHostname() {
  try {
    return os.hostname();
  } catch {
    return "unknown-host";
  }
}

function readClaudeConfig(homedir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(homedir, ".claude.json"), "utf8"));
  } catch {
    return null;
  }
}

function probeCliPresence() {
  const presence = {};
  for (const name of cliAllowlist) {
    presence[name] = commandExists(name);
  }
  return presence;
}

function commandExists(name) {
  // `which` (no shell) checks PATH availability without arg-escaping concerns.
  try {
    execFileSync("which", [name], { stdio: "ignore", timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

function readLaunchAgents(homedir, redact) {
  const dir = path.join(homedir, "Library", "LaunchAgents");
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.startsWith("com.hisenzi.") && f.endsWith(".plist"));
  } catch {
    return [];
  }
  return files.map((name) => {
    let hint = null;
    try {
      const text = fs.readFileSync(path.join(dir, name), "utf8");
      const match = text.match(/<string>([^<]*\.(?:sh|mjs|js|py)[^<]*)<\/string>/);
      if (match) hint = redact(match[1].trim());
    } catch {
      hint = null;
    }
    return { name, program_hint: hint };
  });
}

function readHooks(collabRoot, redact) {
  const candidates = [
    { source: "$COLLAB/.claude/settings.json", file: path.join(collabRoot, ".claude", "settings.json") },
    { source: "$COLLAB/.claude/settings.local.json", file: path.join(collabRoot, ".claude", "settings.local.json") },
  ];
  const rows = [];
  for (const { source, file } of candidates) {
    let cfg;
    try {
      cfg = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    if (!cfg.hooks || typeof cfg.hooks !== "object") continue;
    const generatorHints = new Set();
    for (const entries of Object.values(cfg.hooks)) {
      for (const entry of Array.isArray(entries) ? entries : []) {
        for (const hook of entry.hooks || []) {
          const cmd = String(hook.command || "");
          const scriptMatch = cmd.match(/([\w-]+\.(?:mjs|js|py|sh))/g);
          if (scriptMatch) scriptMatch.forEach((s) => generatorHints.add(redact(s)));
        }
      }
    }
    rows.push({
      source,
      hook_events: Object.keys(cfg.hooks),
      generator_hints: [...generatorHints].sort(),
    });
  }
  return rows;
}

function readSecrets(collabRoot) {
  const dir = path.join(collabRoot, "notyet-harness", "000_Agent", "config", "secrets");
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => !f.startsWith("."));
  } catch {
    return [];
  }
  return files.map((name) => {
    let mtime = null;
    try {
      mtime = fs.statSync(path.join(dir, name)).mtime.toISOString();
    } catch {
      mtime = null;
    }
    return { name, exists: true, mtime };
  });
}

function readRegistry(root) {
  try {
    return JSON.parse(
      fs.readFileSync(
        path.join(root, "system-workflow", "registries", "morrowise-api-cli-mcp-capability-registry.json"),
        "utf8",
      ),
    );
  } catch {
    return { capabilities: [] };
  }
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isCli) {
  // cc-runner variant: a Claude Code runner passes the servers actually mounted in
  // its live session (which includes account-layer connectors absent from config)
  // via CAPABILITY_SESSION_MCP="name1,name2". Plain node runs leave it unset →
  // session_probe stays "unavailable" rather than falsely claiming no account layer.
  const sessionEnv = process.env.CAPABILITY_SESSION_MCP;
  const sessionMcpServers = sessionEnv
    ? sessionEnv.split(",").map((s) => s.trim()).filter(Boolean)
    : null;
  generateCapabilityObserved({ sessionMcpServers });
}
