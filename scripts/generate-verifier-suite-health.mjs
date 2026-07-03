import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outPath = path.join(root, "public", "data", "verifier-suite-health.json");

const DEFAULT_TIMEOUT_MS = 120_000;
const SELF_TEST_SCRIPT = "test:verifier-suite-health";

export function generateVerifierSuiteHealth(options = {}) {
  const repoRoot = options.root || root;
  const generatedAt = options.generatedAt || new Date().toISOString();
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const scripts = options.scripts || readTestScripts(repoRoot);
  const selectedScripts = Object.entries(scripts)
    .filter(([name]) => name !== SELF_TEST_SCRIPT)
    .sort(([a], [b]) => a.localeCompare(b));

  const runScript = options.runner || defaultRunner;
  const verifiers = selectedScripts.map(([name, command]) => {
    const started = Date.now();
    const result = runScript({ name, command, cwd: repoRoot, timeoutMs });
    const durationMs = Number.isFinite(result.duration_ms) ? result.duration_ms : Date.now() - started;
    const exitCode = Number.isFinite(result.exit_code) ? result.exit_code : 1;
    const status = exitCode === 0 ? "pass" : "fail";

    return {
      script: name,
      command,
      status,
      exit_code: exitCode,
      duration_ms: durationMs,
      failure_excerpt: status === "fail" ? failureExcerpt(result, repoRoot) : null,
      last_run_at: generatedAt,
    };
  });

  const failed = verifiers.filter((item) => item.status === "fail");
  const summary = {
    total: verifiers.length,
    passed: verifiers.length - failed.length,
    failed: failed.length,
    skipped: 1,
    skipped_scripts: [SELF_TEST_SCRIPT],
    duration_ms: verifiers.reduce((sum, item) => sum + item.duration_ms, 0),
  };

  const data = {
    schema_version: "verifier-suite-health.v0",
    generated_at: generatedAt,
    read_only: true,
    source: {
      package_scripts: "$COLLAB/harness-mc/package.json#scripts",
      test_script_selector: "scripts with names beginning test:*",
      excluded_scripts: [SELF_TEST_SCRIPT],
      exclusion_reason: "Avoid recursive generator -> verifier -> generator execution.",
    },
    source_files: [
      "$COLLAB/harness-mc/package.json",
      "$COLLAB/harness-mc/scripts/generate-verifier-suite-health.mjs",
      "$COLLAB/harness-mc/scripts/verify-verifier-suite-health.mjs",
    ],
    generator: "$COLLAB/harness-mc/scripts/generate-verifier-suite-health.mjs",
    stale_rule: "Regenerate after package.json test:* script changes, verifier script edits, prebuild changes, failed CI, or agent handoff; treat data older than 24 hours as stale during active work.",
    write_boundary: {
      mode: "read_only_verifier_observability",
      allowed: [
        "read package.json script names and commands",
        "execute local test:* verifier commands",
        "capture sanitized pass/fail metadata",
        "write generated verifier suite health read model",
      ],
      forbidden: [
        "read secrets",
        "print tokens or credential values",
        "execute external writes",
        "mutate tasks.json",
        "git add",
        "git commit",
        "git push",
      ],
    },
    summary,
    verifiers,
    next_action: nextAction(failed),
    verifier_ref: "npm run test:verifier-suite-health",
  };

  if (options.write !== false) {
    fs.mkdirSync(path.dirname(options.outPath || outPath), { recursive: true });
    fs.writeFileSync(options.outPath || outPath, `${JSON.stringify(data, null, 2)}\n`);
    console.log(
      `Generated ${options.outPath || outPath} — ${summary.passed}/${summary.total} passed, ${summary.failed} failed`,
    );
  }

  return data;
}

function readTestScripts(repoRoot) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  return Object.fromEntries(
    Object.entries(packageJson.scripts || {}).filter(([name]) => name.startsWith("test:")),
  );
}

function defaultRunner({ command, cwd, timeoutMs }) {
  const started = Date.now();
  const result = spawnSync(command, {
    cwd,
    shell: true,
    encoding: "utf8",
    timeout: timeoutMs,
    env: {
      ...process.env,
      npm_config_loglevel: "silent",
    },
  });

  return {
    exit_code: result.status ?? (result.error ? 1 : 0),
    duration_ms: Date.now() - started,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error?.message || null,
  };
}

function failureExcerpt(result, repoRoot) {
  const raw = [
    result.error ? `error: ${result.error}` : "",
    result.stderr || "",
    result.stdout || "",
  ].filter(Boolean).join("\n");
  const sanitized = sanitizeLocalPaths(raw, repoRoot)
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .slice(-20)
    .join("\n");
  return sanitized.slice(0, 4000);
}

function sanitizeLocalPaths(value, repoRoot) {
  const collabRoot = path.resolve(repoRoot, "..");
  return String(value)
    .replaceAll(repoRoot, "$COLLAB/harness-mc")
    .replaceAll(collabRoot, "$COLLAB")
    .replace(new RegExp(escapeRegExp(process.env.HOME || ""), "g"), "$HOME");
}

function nextAction(failed) {
  if (failed.length > 0) {
    const first = failed[0];
    return {
      type: "fix_failed_verifier",
      target: first.script,
      label: `Run ${first.script}, inspect sanitized failure_excerpt, then fix the owning verifier or source contract.`,
    };
  }

  return {
    type: "none",
    target: null,
    label: "All tracked package.json test:* verifiers passed in the latest suite run.",
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isCli) {
  generateVerifierSuiteHealth();
}
