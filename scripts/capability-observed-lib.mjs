// Pure transforms for the MorroWise capability observed scan (JV-19).
// No fs / exec here — callers inject already-read data so this stays unit-testable.
//
// Red line: this module only ever handles SAFE METADATA. Callers must never pass
// credential content in. MCP extraction whitelists name/scope/type/endpoint-host
// and drops env, headers, args, full url, and command paths on purpose.

const CLI_ALLOWLIST = [
  "claude",
  "codex",
  "gh",
  "heptabase",
  "node",
  "npm",
  "obsidian",
  "playwright",
  "python3",
];

// Curated keyword → registry capability aliases. Derived from the registry's
// provider/entrypoint identities; used to decide whether an observed integration
// maps to a declared capability or is drift.
const REGISTRY_ALIAS_TOKENS = {
  heptabase: ["heptabase-cli-task-cards", "heptabase-pai-legacy-mcp-oauth"],
  playwright: ["playwright-cli"],
  telegram: ["morrowise-notification-delivery-adapters"],
  line: ["morrowise-notification-delivery-adapters"],
  notify: ["morrowise-notification-delivery-adapters"],
};

export function redactPaths(value, { homedir, collabRoot } = {}) {
  if (typeof value !== "string") return value;
  let out = value;
  if (collabRoot) out = out.split(collabRoot).join("$COLLAB");
  if (homedir) out = out.split(homedir).join("~");
  return out;
}

// Extract safe MCP server metadata from a parsed ~/.claude.json object.
// Returns [{ name, scope, type, endpoint_hint }]. Never returns env/args/tokens.
export function extractMcpServers(claudeJson, { homedir, collabRoot } = {}) {
  if (!claudeJson || typeof claudeJson !== "object") return [];
  const rows = [];
  const pushScope = (scopeLabel, servers) => {
    if (!servers || typeof servers !== "object") return;
    for (const [name, cfg] of Object.entries(servers)) {
      rows.push({
        name,
        scope: scopeLabel,
        type: safeType(cfg),
        endpoint_hint: safeEndpointHint(cfg),
      });
    }
  };

  pushScope("global", claudeJson.mcpServers);
  const projects = claudeJson.projects && typeof claudeJson.projects === "object" ? claudeJson.projects : {};
  for (const [projectPath, projectCfg] of Object.entries(projects)) {
    const servers = projectCfg && projectCfg.mcpServers;
    if (!servers || Object.keys(servers).length === 0) continue;
    pushScope(scopeLabel(projectPath, { homedir, collabRoot }), servers);
  }
  return rows.sort((a, b) => `${a.name}:${a.scope}`.localeCompare(`${b.name}:${b.scope}`));
}

function safeType(cfg) {
  if (!cfg || typeof cfg !== "object") return "unknown";
  if (cfg.type) return String(cfg.type);
  if (cfg.url) return "http";
  if (cfg.command) return "stdio";
  return "unknown";
}

// Only the host survives for http (drops path/query/userinfo → no tokens).
// Only the command basename survives for stdio (drops args → no secrets).
function safeEndpointHint(cfg) {
  if (!cfg || typeof cfg !== "object") return null;
  if (cfg.url) {
    try {
      return new URL(String(cfg.url)).host;
    } catch {
      return "unparseable-url";
    }
  }
  if (cfg.command) {
    const parts = String(cfg.command).split(/[\\/]/);
    return parts[parts.length - 1] || "command";
  }
  return null;
}

function scopeLabel(projectPath, { homedir, collabRoot } = {}) {
  if (collabRoot && projectPath === collabRoot) return "$COLLAB";
  if (collabRoot && projectPath.startsWith(`${collabRoot}/`)) {
    return `$COLLAB/${projectPath.slice(collabRoot.length + 1)}`;
  }
  if (homedir && projectPath === homedir) return "$HOME";
  if (homedir && projectPath.startsWith(`${homedir}/`)) {
    return `~/${projectPath.slice(homedir.length + 1)}`;
  }
  return "external";
}

// probeResults: { [cliName]: boolean }  (existence only, from `command -v`)
export function buildCliObservations(probeResults = {}) {
  return CLI_ALLOWLIST.map((name) => ({
    name,
    present: Boolean(probeResults[name]),
  }));
}

export const cliAllowlist = CLI_ALLOWLIST;

// entries: [{ name, program_hint }] already redacted by caller.
export function buildLaunchdObservations(entries = []) {
  return entries
    .map((e) => ({ name: e.name, program_hint: e.program_hint || null }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// sources: [{ source, hook_events: [...], generator_hints: [...] }]
export function buildHookObservations(sources = []) {
  return sources.filter((s) => s && s.source);
}

// entries: [{ name, exists, mtime }] — existence + mtime only, never content.
export function buildSecretObservations(entries = []) {
  return entries
    .map((e) => ({ name: e.name, exists: Boolean(e.exists), mtime: e.mtime || null }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function aliasMatchesForName(name) {
  const lower = String(name).toLowerCase();
  const hits = new Set();
  for (const [token, capabilityIds] of Object.entries(REGISTRY_ALIAS_TOKENS)) {
    if (lower.includes(token)) {
      for (const id of capabilityIds) hits.add(id);
    }
  }
  return hits;
}

// Compute bidirectional drift between observed integrations and declared registry.
//
// observed: {
//   mcp_servers: [{name, scope, type}],
//   session_mcp_servers: [name, ...] | null,   // cc-runner variant; null = not probed
//   clis: [{name, present}],
// }
// declaredProbes: [{ capability_id, kind, match_token?, present?, expected_absent?, scannable? }]
//
// Returns { observed_not_declared, declared_not_observed, aligned, session_probe }.
export function computeDrift(observed = {}, declaredProbes = []) {
  const mcpServers = observed.mcp_servers || [];
  const clis = observed.clis || [];
  const sessionServers = Array.isArray(observed.session_mcp_servers) ? observed.session_mcp_servers : null;

  const declaredIds = new Set(declaredProbes.map((p) => p.capability_id));
  const observedNotDeclared = [];
  const aligned = [];

  // --- MCP servers (file scan) ---
  const seenFileScanNames = new Set();
  for (const server of mcpServers) {
    seenFileScanNames.add(server.name);
    const related = [...aliasMatchesForName(server.name)].filter((id) => declaredIds.has(id));
    // An MCP server only counts as "aligned" if a declared capability of MCP kind
    // covers it. Registry heptabase items are CLI + legacy-oauth routes, so the
    // live CC http heptabase-mcp is intentionally surfaced as drift, not aligned.
    const mcpDeclared = related.filter((id) => {
      const probe = declaredProbes.find((p) => p.capability_id === id);
      return probe && probe.kind === "mcp";
    });
    if (mcpDeclared.length > 0) {
      aligned.push({ observed: mcpServerKey(server), matched: mcpDeclared });
    } else {
      observedNotDeclared.push({
        observed: mcpServerKey(server),
        kind: "mcp_server",
        origin: "local_config",
        related_registry: related,
        note: related.length
          ? "Keyword-related to a declared capability but a different route/type; registry has no entry for this exact MCP server."
          : "No registry capability covers this MCP server.",
      });
    }
  }

  // --- Session-mounted MCP (cc-runner variant; detects account-layer connectors) ---
  if (sessionServers) {
    for (const name of sessionServers) {
      if (seenFileScanNames.has(name)) continue; // already covered by file scan
      const related = [...aliasMatchesForName(name)].filter((id) => declaredIds.has(id));
      observedNotDeclared.push({
        observed: `session:${name}`,
        kind: "mcp_server",
        origin: "account_layer",
        related_registry: related,
        note: "Mounted in the live agent session but absent from local MCP config — account-layer connector or ephemeral mount not tracked by the registry.",
      });
    }
  }

  // --- Declared capabilities with a scannable local footprint ---
  const declaredNotObserved = [];
  for (const probe of declaredProbes) {
    if (probe.expected_absent) continue; // legacy: absence is expected, not drift
    if (probe.scannable === false) continue; // contract-only, not locally scannable
    if (probe.kind === "cli") {
      const cli = clis.find((c) => c.name === (probe.match_token || probe.capability_id));
      const present = probe.present !== undefined ? probe.present : cli ? cli.present : false;
      if (present) {
        aligned.push({ observed: `cli:${probe.match_token || probe.capability_id}`, matched: [probe.capability_id] });
      } else {
        declaredNotObserved.push({
          capability_id: probe.capability_id,
          kind: "cli",
          note: "Registry declares this capability but its CLI footprint is absent on this machine (command not on PATH).",
        });
      }
    }
  }

  return {
    observed_not_declared: observedNotDeclared,
    declared_not_observed: declaredNotObserved,
    aligned,
    session_probe: sessionServers ? "available" : "unavailable",
  };
}

function mcpServerKey(server) {
  return `mcp:${server.name}@${server.scope}`;
}

// Guardrail: assert no home-absolute path or token-like field leaked into output.
export function assertNoLeak(serialized) {
  const problems = [];
  if (/\/Users\/[A-Za-z]/.test(serialized)) problems.push("home-absolute path (/Users/...)");
  for (const token of [
    "access_token",
    "refresh_token",
    "client_secret",
    "NOTION_TOKEN",
    "TELEGRAM_BOT_TOKEN",
    "LINE_CHANNEL_ACCESS_TOKEN",
    "api_key",
    "apiKey",
  ]) {
    if (serialized.includes(token)) problems.push(`token-like field: ${token}`);
  }
  return problems;
}
