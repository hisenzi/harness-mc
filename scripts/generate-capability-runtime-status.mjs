// Generate the MorroWise API / CLI / MCP runtime status read model.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(__dirname, "..");
const DATA_DIR = path.join("public", "data");

const REGISTRY_STATUSES = new Set(["ready", "legacy", "unknown", "blocked", "prototype", "not_applicable"]);
const RUNTIME_STATUSES = new Set(["connected", "configured", "missing", "needs_auth", "unknown", "not_applicable", "degraded"]);
const CONTRACT_STATUSES = new Set(["ready", "contract_ready", "not_verified", "not_applicable", "degraded"]);
const AUTH_STATUSES = new Set(["authenticated", "needs_auth", "not_required", "unknown"]);

export function generateCapabilityRuntimeStatus(options = {}) {
  const root = options.root || defaultRoot;
  const collabRoot = path.resolve(root, "..");
  const generatedAt = options.generatedAt || new Date().toISOString();
  const probes = options.probes || {};
  const outPath = options.outPath || path.join(root, DATA_DIR, "capability-runtime-status.json");

  const registryReadModel = readJsonOrNull(path.join(root, DATA_DIR, "morrowise-capabilities.json"));
  const registryItems = registryReadModel?.capabilities || [];
  const notificationContract = readJsonOrNull(path.join(root, "system-workflow", "registries", "morrowise-notification-adapter-contract.json"));

  const claudeMcp = probes.claudeMcpList || runCommand("claude", ["mcp", "list"], { timeoutMs: 10_000 });
  const heptabaseCli = probes.heptabaseWhiteboardList || runCommand("heptabase", ["whiteboard", "list", "--limit", "1"], { timeoutMs: 10_000 });
  const playwright = probes.playwrightVersion || runCommand("playwright", ["--version"], { timeoutMs: 3_000 });
  const codexConfig = probes.codexConfig || readCodexHeptabaseConfig(collabRoot);

  const items = [
    registryHeptabaseCliItem(registryItems),
    ccHeptabaseMcpItem(claudeMcp),
    codexHeptabaseMcpItem(codexConfig),
    heptabaseLocalCliItem(heptabaseCli),
    playwrightCliItem(playwright, registryItems),
    notionMcpItem(claudeMcp),
    notificationAdapterItem(notificationContract, registryItems),
    legacyHeptabasePaiMcpItem(registryItems),
  ].map(normalizeItem);

  const data = {
    schema_version: "capability-runtime-status.v0",
    generated_at: generatedAt,
    read_only: true,
    task_anchor: "$COLLAB/harness-mc/milestones/morrowise/tasks.json#capability-runtime-status-read-model",
    source_layers: {
      registry_snapshot: {
        source_ref: "$COLLAB/harness-mc/public/data/morrowise-capabilities.json",
        role: "Canonical capability inventory, history, owner task, and boundary metadata.",
      },
      runtime_probe: {
        source_ref: "local read-only command output and config shape",
        role: "Current local connection/auth/install observation without reading credential stores.",
      },
      contract_verifier: {
        source_ref: "npm run test:notification-adapter-contract / npm run test:capability-registry",
        role: "Contract and registry verifier evidence; does not prove external delivery happened.",
      },
      manual_evidence: {
        source_ref: "Vincent-provided screenshots or explicit auth confirmation",
        role: "Supplemental evidence only; must not replace canonical registry or probe output.",
      },
    },
    write_boundary: {
      allowed: [
        "read generated registry read model",
        "read non-secret MCP health output",
        "read Heptabase CLI health output",
        "read config shape",
        "write generated runtime status read model",
      ],
      forbidden: [
        "read OAuth token content",
        "read Notion token content",
        "read MCP auth storage content",
        "read browser cookies or profiles",
        "read schedule/.env values",
        "read local app private storage",
        "execute external writes",
        "sync Heptabase / Notion / notification adapters",
      ],
    },
    status_vocabulary: {
      registry_status: [...REGISTRY_STATUSES],
      runtime_status: [...RUNTIME_STATUSES],
      contract_status: [...CONTRACT_STATUSES],
      auth_status: [...AUTH_STATUSES],
    },
    summary: summarize(items),
    items,
    next_actions: items
      .filter((item) => shouldExposeNextAction(item))
      .map((item) => ({ id: item.id, target: item.next_action.target, label: item.next_action.label })),
  };

  if (options.write !== false) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(data, null, 2)}\n`);
    console.log(`Generated ${outPath} — ${items.length} status items, ${data.next_actions.length} next actions`);
  }

  return data;
}

function registryHeptabaseCliItem(registryItems) {
  const registry = findRegistryItem(registryItems, "heptabase-cli-task-cards");
  return {
    id: "registry.heptabase-cli-task-cards",
    label: "Heptabase task-card registry",
    source_layer: "registry_snapshot",
    registry_status: registry?.status || "unknown",
    runtime_status: "not_applicable",
    contract_status: "not_applicable",
    auth_status: "not_required",
    evidence_refs: [
      "$COLLAB/harness-mc/public/data/morrowise-capabilities.json#heptabase-cli-task-cards",
      "$COLLAB/harness-mc/system-workflow/registries/morrowise-api-cli-mcp-capability-registry.json",
    ],
    next_action: {
      target: registry?.next_action?.task_id || "api-cli-mcp-capability-registry-v0",
      label: registry?.next_action?.description || "Keep Heptabase CLI task-card route visible in registry.",
    },
  };
}

function ccHeptabaseMcpItem(probe) {
  const match = parseMcpLine(combinedOutput(probe), "heptabase-mcp");
  const connected = match?.status === "connected";
  const needsAuth = match?.status === "needs_auth";
  const degraded = match?.status === "degraded";
  return {
    id: "runtime.cc-heptabase-mcp",
    label: "Claude Code Heptabase MCP",
    source_layer: "runtime_probe",
    registry_status: "not_applicable",
    runtime_status: connected ? "connected" : needsAuth ? "needs_auth" : degraded ? "degraded" : "unknown",
    contract_status: "not_applicable",
    auth_status: connected ? "authenticated" : needsAuth ? "needs_auth" : "unknown",
    evidence_refs: ["claude mcp list"],
    next_action: {
      target: connected ? "none" : "cc-heptabase-mcp-auth",
      label: connected ? "No runtime action required from current probe." : "Open Claude Code /mcp and authenticate heptabase-mcp.",
    },
  };
}

function codexHeptabaseMcpItem(config) {
  return {
    id: "runtime.codex-heptabase-mcp",
    label: "Codex Heptabase MCP config",
    source_layer: "runtime_probe",
    registry_status: "not_applicable",
    runtime_status: config.configured ? "configured" : "unknown",
    contract_status: "not_applicable",
    auth_status: "unknown",
    evidence_refs: [config.source_ref || "$COLLAB/.codex/config.toml"],
    next_action: {
      target: "codex-heptabase-mcp-runtime-probe",
      label: config.configured
        ? "Config shape exists; use a Codex MCP tool availability probe before calling it live."
        : "Add or verify Codex Heptabase MCP config before relying on Codex remote MCP.",
    },
  };
}

function heptabaseLocalCliItem(probe) {
  const parsed = parseJsonFromText(combinedOutput(probe));
  const connected = Boolean(probe.ok && parsed && Array.isArray(parsed.whiteboards));
  const degraded = !connected && /cannot connect to the desktop app|enable CLI|heptabase start/i.test(combinedOutput(probe));
  return {
    id: "runtime.heptabase-local-cli",
    label: "Heptabase local CLI",
    source_layer: "runtime_probe",
    registry_status: "not_applicable",
    runtime_status: connected ? "connected" : degraded ? "degraded" : "unknown",
    contract_status: "not_applicable",
    auth_status: connected ? "authenticated" : "unknown",
    evidence_refs: ["heptabase whiteboard list --limit 1"],
    metrics: {
      whiteboard_total: Number.isFinite(parsed?.total) ? parsed.total : null,
      sampled_whiteboard_name: parsed?.whiteboards?.[0]?.name || null,
    },
    next_action: {
      target: connected ? "none" : "heptabase-local-cli-probe",
      label: connected ? "Local CLI read probe succeeded." : "Open Heptabase Desktop Local CLI Server or inspect CLI availability.",
    },
  };
}

function playwrightCliItem(probe, registryItems) {
  const registry = findRegistryItem(registryItems, "playwright-cli");
  const missing = !probe.ok && (probe.exit_code === 127 || /not found|command not found|ENOENT/i.test(`${probe.stderr || ""} ${probe.error || ""}`));
  return {
    id: "runtime.playwright-cli",
    label: "Playwright CLI",
    source_layer: "runtime_probe",
    registry_status: registry?.status || "unknown",
    runtime_status: probe.ok ? "connected" : missing ? "missing" : "unknown",
    contract_status: "not_applicable",
    auth_status: "not_required",
    evidence_refs: ["playwright --version", "$COLLAB/harness-mc/public/data/morrowise-capabilities.json#playwright-cli"],
    metrics: {
      version: probe.ok ? String(probe.stdout || "").trim() : null,
    },
    next_action: {
      target: "playwright-cli-capability-probe",
      label: probe.ok
        ? "Decide whether Playwright should become project-local or remain global runtime metadata."
        : "Resolve Playwright ownership: project-local dependency, documented global CLI, or Codex browser/chrome tools.",
    },
  };
}

function notionMcpItem(probe) {
  const match = parseMcpLine(combinedOutput(probe), "notion-edu");
  const connected = match?.status === "connected";
  const needsAuth = match?.status === "needs_auth";
  const degraded = match?.status === "degraded";
  return {
    id: "runtime.notion-mcp",
    label: "Notion MCP",
    source_layer: "runtime_probe",
    registry_status: "not_applicable",
    runtime_status: connected ? "connected" : needsAuth ? "needs_auth" : degraded ? "degraded" : "unknown",
    contract_status: "not_applicable",
    auth_status: connected ? "authenticated" : needsAuth ? "needs_auth" : "unknown",
    evidence_refs: ["claude mcp list"],
    next_action: {
      target: connected ? "none" : "notion-mcp-auth",
      label: connected ? "No auth action required from current probe." : "Authenticate Notion MCP explicitly before using Notion runtime writes.",
    },
  };
}

function notificationAdapterItem(contract, registryItems) {
  const registry = findRegistryItem(registryItems, "morrowise-notification-delivery-adapters");
  const contractReady = Boolean(contract?.registry_id || registry?.latest_history?.event_type === "contract_confirmed");
  return {
    id: "contract.notification-adapter",
    label: "Notification adapter contract",
    source_layer: "contract_verifier",
    registry_status: registry?.status || "unknown",
    runtime_status: "not_applicable",
    contract_status: contractReady ? "contract_ready" : "not_verified",
    auth_status: "unknown",
    evidence_refs: [
      "$COLLAB/harness-mc/system-workflow/registries/morrowise-notification-adapter-contract.json",
      "npm run test:notification-adapter-contract",
    ],
    next_action: {
      target: "reality-tax-daily-review-task",
      label: "Use the contract when wiring runtime delivery; contract_ready does not prove external delivery is live.",
    },
  };
}

function legacyHeptabasePaiMcpItem(registryItems) {
  const registry = findRegistryItem(registryItems, "heptabase-pai-legacy-mcp-oauth");
  return {
    id: "legacy.heptabase-pai-mcp-oauth",
    label: "Legacy Heptabase PAI MCP/OAuth",
    source_layer: "registry_snapshot",
    registry_status: registry?.status || "legacy",
    runtime_status: "not_applicable",
    contract_status: "not_applicable",
    auth_status: "unknown",
    evidence_refs: [
      "$COLLAB/harness-mc/public/data/morrowise-capabilities.json#heptabase-pai-legacy-mcp-oauth",
      "$COLLAB/harness-mc/milestones/harness-mc/tasks.json#heptabase-pai-legacy-archive",
    ],
    next_action: {
      target: "heptabase-pai-legacy-archive",
      label: "Keep legacy MCP/OAuth fallback out of the normal path until decouple/archive work completes.",
    },
  };
}

function normalizeItem(item) {
  return {
    metrics: {},
    ...item,
    registry_status: ensureVocabulary(item.registry_status, REGISTRY_STATUSES, "unknown"),
    runtime_status: ensureVocabulary(item.runtime_status, RUNTIME_STATUSES, "unknown"),
    contract_status: ensureVocabulary(item.contract_status, CONTRACT_STATUSES, "not_verified"),
    auth_status: ensureVocabulary(item.auth_status, AUTH_STATUSES, "unknown"),
  };
}

function summarize(items) {
  return {
    total: items.length,
    by_source_layer: countBy(items, "source_layer"),
    by_registry_status: countBy(items, "registry_status"),
    by_runtime_status: countBy(items, "runtime_status"),
    by_contract_status: countBy(items, "contract_status"),
    by_auth_status: countBy(items, "auth_status"),
  };
}

function shouldExposeNextAction(item) {
  return !(
    item.next_action?.target === "none" ||
    (item.runtime_status === "connected" && item.registry_status !== "legacy" && item.contract_status !== "contract_ready")
  );
}

function countBy(items, key) {
  const counts = {};
  for (const item of items) {
    counts[item[key]] = (counts[item[key]] || 0) + 1;
  }
  return counts;
}

function parseMcpLine(stdout = "", name) {
  const line = String(stdout).split(/\r?\n/).find((candidate) => candidate.startsWith(`${name}:`));
  if (!line) return null;
  if (/Needs authentication/i.test(line)) return { line, status: "needs_auth" };
  if (/Connected/i.test(line)) return { line, status: "connected" };
  if (/Failed/i.test(line)) return { line, status: "degraded" };
  return { line, status: "unknown" };
}

function readCodexHeptabaseConfig(collabRoot) {
  const configPath = path.join(collabRoot, ".codex", "config.toml");
  try {
    const text = fs.readFileSync(configPath, "utf8");
    return {
      ok: true,
      configured: /\[mcp_servers\.heptabase-mcp\][\s\S]*?url = "https:\/\/api\.heptabase\.com\/mcp"/.test(text),
      source_ref: "$COLLAB/.codex/config.toml",
    };
  } catch (error) {
    return {
      ok: false,
      configured: false,
      source_ref: "$COLLAB/.codex/config.toml",
      error: error.message,
    };
  }
}

function runCommand(command, args, { timeoutMs }) {
  try {
    const stdout = execFileSync(command, args, {
      encoding: "utf8",
      timeout: timeoutMs,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, stdout, stderr: "", exit_code: 0 };
  } catch (error) {
    return {
      ok: false,
      stdout: error.stdout ? String(error.stdout) : "",
      stderr: error.stderr ? String(error.stderr) : "",
      exit_code: typeof error.status === "number" ? error.status : error.code === "ENOENT" ? 127 : null,
      error: error.message,
    };
  }
}

function findRegistryItem(items, id) {
  return items.find((item) => item.id === id) || null;
}

function readJsonOrNull(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseJsonFromText(text) {
  const parsed = parseJson(text);
  if (parsed) return parsed;
  const start = String(text).indexOf("{");
  const end = String(text).lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return parseJson(String(text).slice(start, end + 1));
}

function combinedOutput(probe) {
  return `${probe.stdout || ""}\n${probe.stderr || ""}`;
}

function ensureVocabulary(value, vocabulary, fallback) {
  return vocabulary.has(value) ? value : fallback;
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isCli) {
  generateCapabilityRuntimeStatus();
}
