// Generate the MorroWise Notion sync-state read model without external writes.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(__dirname, "..");
const DATA_DIR = path.join("public", "data");

export function generateNotionSyncState(options = {}) {
  const root = options.root || defaultRoot;
  const collabRoot = path.resolve(root, "..");
  const generatedAt = options.generatedAt || new Date().toISOString();
  const outPath = options.outPath || path.join(root, DATA_DIR, "notion-sync-state.json");

  const registry = readJsonOrNull(path.join(root, "system-workflow", "registries", "morrowise-notion-sync-state.json"));
  const notionApiKeyProbe = options.notionApiKeyProbe || probeNotionApiKey(collabRoot);
  const notionMcpProbe = options.notionMcpProbe || runCommand("claude", ["mcp", "list"], { timeoutMs: 10_000 });
  const databases = buildDatabases(root);
  const fixtures = buildFixtures(root);

  const data = {
    schema_version: "notion-sync-state.v0",
    generated_at: generatedAt,
    read_only: true,
    source: "$COLLAB/harness-mc/system-workflow/registries/morrowise-notion-sync-state.json",
    generator: "$COLLAB/harness-mc/scripts/generate-notion-sync-state.mjs",
    verifier_ref: "npm run test:notion-sync-state",
    task_anchor: "$COLLAB/harness-mc/milestones/morrowise/tasks.json#notion-sync-read-model-v0",
    source_registry_status: registry?.status || "read_model_contract",
    source_layers: {
      notion_snapshot: {
        source_ref: "$COLLAB/harness-mc/system-workflow/snapshots/kj-notion-tasks-snapshot.json",
        role: "Non-secret Notion database schema, row-count, title, and task metadata captured by a prior read-only probe.",
      },
      mc_mirror: {
        source_ref: "$COLLAB/harness-mc/milestones/*/tasks.json",
        role: "MC task mirror used only for count and drift comparison.",
      },
      runtime_route_probe: {
        source_ref: "notion.env existence and claude mcp list health output",
        role: "Separates API-key script route from MCP connector route without reading credential values.",
      },
    },
    write_boundary: {
      allowed: [
        "read non-secret Notion snapshot metadata",
        "read MC mirror tasks",
        "read local sync-state ids",
        "probe credential file existence",
        "probe MCP health output",
        "write generated notion sync-state read model",
      ],
      forbidden: [
        "write Notion",
        "read or print NOTION_TOKEN",
        "read OAuth token content",
        "read browser cookies or profiles",
        "rewrite tasks.json mirrors",
        "trigger Heptabase / PAI / Telegram / LINE delivery",
      ],
    },
    runtime_routes: {
      notion_api_key: notionApiKeyRoute(notionApiKeyProbe),
      notion_mcp_connector: notionMcpConnectorRoute(notionMcpProbe),
    },
    summary: summarize(databases),
    databases,
    fixtures,
    next_actions: buildNextActions(databases),
  };

  if (options.write !== false) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(data, null, 2)}\n`);
    console.log(`Generated ${outPath} — ${databases.length} databases, ${data.summary.drift} drift`);
  }

  return data;
}

function buildDatabases(root) {
  const databases = [];
  const kj = kjBilingualDatabase(root);
  if (kj) databases.push(kj);

  databases.push(paiActionDatabase(root));
  databases.push(coursesDatabase(root));

  return databases;
}

function kjBilingualDatabase(root) {
  const snapshotPath = path.join(root, "system-workflow", "snapshots", "kj-notion-tasks-snapshot.json");
  const mirrorPath = path.join(root, "milestones", "kj-bilingual", "tasks.json");
  const snapshot = readJsonOrNull(snapshotPath);
  const mirror = readJsonOrNull(mirrorPath);
  if (!snapshot) return null;

  const mirrorTasks = mirror?.tasks || [];
  const drift = compareSnapshotToMirror(snapshot.tasks || [], mirrorTasks);

  return normalizeDatabase({
    id: "kj-bilingual-action-db",
    label: "KJ 雙語班行動庫",
    notion_db: {
      database_id: snapshot.source_of_truth?.database_id || null,
      data_source_id: snapshot.source_of_truth?.data_source_id || null,
      data_source_url: snapshot.source_of_truth?.data_source_url || null,
      project_page_id: snapshot.source_of_truth?.project_page_id || null,
      source_snapshot: "$COLLAB/harness-mc/system-workflow/snapshots/kj-notion-tasks-snapshot.json",
    },
    source_of_truth: "Notion",
    mirror_path: "$COLLAB/harness-mc/milestones/kj-bilingual/tasks.json",
    notion_count: snapshot.tasks?.length || 0,
    mirror_count: mirrorTasks.length,
    drift,
    last_sync: mirror?.mirror_status?.reconciled_at || null,
    sync_direction: "Notion -> MC tasks.json -> Heptabase / PAI mirrors",
    status: drift.length > 0 ? "drift" : "connected",
    schema_property_count: Object.keys(snapshot.notion_database?.schema?.properties || {}).length,
    sample_titles: sampleTitles(snapshot.tasks || []),
    evidence_refs: [
      "$COLLAB/harness-mc/system-workflow/snapshots/kj-notion-tasks-snapshot.json",
      "$COLLAB/harness-mc/milestones/kj-bilingual/tasks.json",
      "$COLLAB/harness-mc/system-workflow/reports/kj-mirror-reconcile-report.md",
    ],
    next_action: drift.length > 0
      ? { type: "task", target: "KJ-LIVE-03", label: "Re-run KJ mirror reconcile before trusting the MC mirror." }
      : { type: "surface", target: "mc-notion-sync-surface", label: "Expose current KJ sync state on the MC read-only surface." },
  });
}

function paiActionDatabase(root) {
  const sentinelScript = fs.readFileSync(path.join(root, "scripts", "sentinel-notion.mjs"), "utf8");
  const databaseId = matchConstValue(sentinelScript, "DATABASE_ID");
  return normalizeDatabase({
    id: "pai-action-db",
    label: "PAI 行動庫",
    notion_db: {
      database_id: databaseId,
      data_source_id: null,
      source_script: "$COLLAB/harness-mc/scripts/sentinel-notion.mjs",
    },
    source_of_truth: "Notion",
    mirror_path: "$COLLAB/harness-mc/public/data/changes.json",
    notion_count: null,
    mirror_count: null,
    drift: [],
    last_sync: null,
    sync_direction: "MC changes.json -> Notion PAI 行動庫重要提醒 view",
    status: "unknown",
    schema_property_count: null,
    sample_titles: [],
    evidence_refs: ["$COLLAB/harness-mc/scripts/sentinel-notion.mjs"],
    next_action: {
      type: "probe",
      target: "notion-sync-read-model-v0",
      label: "Add a non-secret PAI database snapshot/probe before claiming count-level sync.",
    },
  });
}

function coursesDatabase(root) {
  const script = fs.readFileSync(path.join(root, "scripts", "sync-notion-courses.mjs"), "utf8");
  const databaseId = matchConstValue(script, "DATABASE_ID");
  const mirror = readJsonOrNull(path.join(root, "milestones", "self-learning", "tasks.json"));
  const courseTasks = (mirror?.tasks || []).filter((task) => ["course", "book", "free", "yt"].includes(task.track));
  return normalizeDatabase({
    id: "self-learning-courses-db",
    label: "Self-learning Courses DB",
    notion_db: {
      database_id: databaseId,
      data_source_id: null,
      source_script: "$COLLAB/harness-mc/scripts/sync-notion-courses.mjs",
    },
    source_of_truth: "Notion",
    mirror_path: "$COLLAB/harness-mc/milestones/self-learning/tasks.json",
    notion_count: null,
    mirror_count: courseTasks.length,
    drift: [],
    last_sync: null,
    sync_direction: "Notion -> MC self-learning tasks.json",
    status: "unknown",
    schema_property_count: null,
    sample_titles: courseTasks.slice(0, 5).map((task) => task.title).filter(Boolean),
    evidence_refs: [
      "$COLLAB/harness-mc/scripts/sync-notion-courses.mjs",
      "$COLLAB/harness-mc/milestones/self-learning/tasks.json",
    ],
    next_action: {
      type: "probe",
      target: "notion-sync-read-model-v0",
      label: "Add a non-secret Courses DB snapshot before comparing live Notion counts.",
    },
  });
}

function buildFixtures(root) {
  const snapshot = readJsonOrNull(path.join(root, "system-workflow", "snapshots", "kj-notion-tasks-snapshot.json"));
  if (!snapshot) return [];
  return [
    {
      id: "kj-generation-drift-2026-07-01",
      label: "KJ generation-time drift fixture",
      source_ref: "$COLLAB/harness-mc/system-workflow/snapshots/kj-notion-tasks-snapshot.json#known_conflicts",
      notion_count: snapshot.summary?.total_tasks || snapshot.tasks?.length || null,
      mirror_count: snapshot.summary?.mc_mirror_count || null,
      drift: snapshot.known_conflicts || [],
      purpose: "Proves the read model can represent a real historical drift case instead of only an empty current-state list.",
    },
  ];
}

function normalizeDatabase(database) {
  return {
    drift: [],
    evidence_refs: [],
    sample_titles: [],
    ...database,
  };
}

function compareSnapshotToMirror(notionTasks, mirrorTasks) {
  const codedNotion = notionTasks.filter((task) => /^[A-FM]\d+$/.test(task.task_key));
  const mirrorById = new Map(mirrorTasks.map((task) => [task.id, task]));
  const notionIds = new Set(codedNotion.map((task) => task.task_key));
  const drift = [];

  for (const task of codedNotion) {
    const mirror = mirrorById.get(task.task_key);
    if (!mirror) {
      drift.push({
        type: "notion_task_missing_in_mc_mirror",
        severity: task.key_gate ? "high" : "medium",
        task_id: task.task_key,
        notion_title: task.title,
        source_of_truth: "notion",
      });
      continue;
    }
    const notionTitle = stripTaskKey(task.title);
    if (mirror.title !== notionTitle || mirror.notion_title !== task.title) {
      drift.push({
        type: "title_mismatch",
        severity: task.key_gate ? "high" : "medium",
        task_id: task.task_key,
        notion_title: task.title,
        mc_title: mirror.notion_title || mirror.title,
        source_of_truth: "notion",
      });
    }
  }

  for (const task of mirrorTasks) {
    if (/^[A-FM]\d+$/.test(task.id) && !notionIds.has(task.id)) {
      drift.push({
        type: "mc_extra_coded_task",
        severity: "medium",
        task_id: task.id,
        mc_title: task.notion_title || task.title,
        source_of_truth: "notion",
      });
    }
  }

  return drift;
}

function sampleTitles(tasks) {
  const priority = ["B2", "B3"];
  const titles = [];
  for (const key of priority) {
    const task = tasks.find((item) => item.task_key === key);
    if (task?.title) titles.push(task.title);
  }
  for (const task of tasks) {
    if (titles.length >= 5) break;
    if (task.title && !titles.includes(task.title)) titles.push(task.title);
  }
  return titles;
}

function notionApiKeyRoute(probe) {
  return {
    id: "runtime.notion-api-key",
    label: "Notion API key script route",
    source_layer: "runtime_route_probe",
    runtime_status: probe.configured ? "configured" : "missing",
    auth_status: probe.configured ? "configured_unverified" : "needs_auth",
    evidence_refs: [
      probe.source_ref || "$COLLAB/notyet-harness/000_Agent/config/secrets/notion.env",
      "$COLLAB/notyet-harness/000_Agent/config/heptabase-clients.json",
    ],
    next_action: probe.configured
      ? { target: "notion-sync-read-model-v0", label: "Use read-only metadata probes; do not print token values." }
      : { target: "notion-api-key-auth", label: "Create or verify notion.env before API-key scripts can run." },
  };
}

function notionMcpConnectorRoute(probe) {
  const match = parseMcpLine(combinedOutput(probe), "notion-edu");
  const connected = match?.status === "connected";
  const needsAuth = match?.status === "needs_auth";
  return {
    id: "runtime.notion-mcp-connector",
    label: "Notion MCP connector route",
    source_layer: "runtime_route_probe",
    runtime_status: connected ? "connected" : needsAuth ? "needs_auth" : "unknown",
    auth_status: connected ? "authenticated" : needsAuth ? "needs_auth" : "unknown",
    evidence_refs: ["claude mcp list"],
    next_action: connected
      ? { target: "none", label: "No MCP connector auth action required from the current probe." }
      : { target: "notion-mcp-auth", label: "Authenticate the Notion MCP connector before relying on MCP live metadata." },
  };
}

function probeNotionApiKey(collabRoot) {
  const envPath = path.join(collabRoot, "notyet-harness", "000_Agent", "config", "secrets", "notion.env");
  const clientsPath = path.join(collabRoot, "notyet-harness", "000_Agent", "config", "heptabase-clients.json");
  return {
    configured: fs.existsSync(envPath) && fs.existsSync(clientsPath),
    source_ref: "$COLLAB/notyet-harness/000_Agent/config/secrets/notion.env",
  };
}

function summarize(databases) {
  return {
    total: databases.length,
    connected: databases.filter((item) => item.status === "connected").length,
    drift: databases.filter((item) => item.status === "drift").length,
    disconnected: databases.filter((item) => item.status === "disconnected").length,
    unknown: databases.filter((item) => item.status === "unknown").length,
  };
}

function buildNextActions(databases) {
  const actions = [];
  if (databases.some((item) => item.status === "drift")) {
    actions.push({ type: "task", target: "notion-sync-read-model-v0", label: "Review drift databases before surfacing sync state." });
  }
  actions.push({ type: "surface", target: "mc-notion-sync-surface", label: "Implement the harness-mc read-only surface from notion-sync-state.json." });
  return actions;
}

function stripTaskKey(title) {
  return String(title).replace(/^\[[^\]]+\]\s*/, "");
}

function matchConstValue(text, name) {
  const match = String(text).match(new RegExp(`const\\s+${name}\\s*=\\s*["']([^"']+)["']`));
  return match?.[1] || null;
}

function parseMcpLine(stdout = "", name) {
  const line = String(stdout).split(/\r?\n/).find((candidate) => candidate.startsWith(`${name}:`));
  if (!line) return null;
  if (/Needs authentication/i.test(line)) return { line, status: "needs_auth" };
  if (/Connected/i.test(line)) return { line, status: "connected" };
  if (/Failed/i.test(line)) return { line, status: "degraded" };
  return { line, status: "unknown" };
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

function readJsonOrNull(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function combinedOutput(probe) {
  return `${probe.stdout || ""}\n${probe.stderr || ""}`;
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isCli) {
  generateNotionSyncState();
}
