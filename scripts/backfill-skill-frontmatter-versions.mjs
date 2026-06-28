import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const collabRoot = path.resolve(repoRoot, "..");
const defaultSkillsDir = path.join(collabRoot, "notyet-harness", "000_Agent", "skills");

function parseArgs(argv) {
  const args = {
    skillsDir: defaultSkillsDir,
    apply: false,
    requireVersionHistory: false,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--skills-dir") {
      args.skillsDir = path.resolve(argv[++i]);
    } else if (arg === "--apply") {
      args.apply = true;
    } else if (arg === "--require-version-history") {
      args.requireVersionHistory = true;
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function usage() {
  return [
    "Usage: node scripts/backfill-skill-frontmatter-versions.mjs [--apply] [--require-version-history] [--skills-dir <path>] [--json]",
    "",
    "Copies SKILL.md body `> version:` values into missing frontmatter `version` fields.",
    "By default this is a dry run. Use --apply to write files.",
    "Use --require-version-history when applying inside the current validation gate so legacy skills without `## 版本歷史` stay untouched.",
  ].join("\n");
}

export function collectVersionBackfillPlan(skillsDir, options = {}) {
  const files = listSkillFiles(skillsDir);
  const rows = [];

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, "utf-8");
    const parsed = parseSkill(content);
    const bodyVersion = extractBodyVersion(parsed.body);
    const hasHistory = /^##\s+版本歷史\s*$/m.test(parsed.body);
    const currentVersion = parsed.frontmatter.version || null;
    const rel = path.relative(skillsDir, filePath);
    const canInspect = !currentVersion && Boolean(bodyVersion);
    const blockedReason = canInspect && !parsed.hasFrontmatter
      ? "missing-frontmatter"
      : canInspect && options.requireVersionHistory && !hasHistory
        ? "missing-version-history"
        : null;
    const canBackfill = parsed.hasFrontmatter && canInspect;

    rows.push({
      rel,
      filePath,
      currentVersion,
      bodyVersion: bodyVersion || null,
      hasHistory,
      action: canBackfill && !blockedReason ? "backfill" : "skip",
      blockedReason,
    });
  }

  return rows;
}

export function applyVersionBackfill(plan) {
  const changed = [];
  for (const row of plan) {
    if (row.action !== "backfill") continue;

    const content = fs.readFileSync(row.filePath, "utf-8");
    const next = insertFrontmatterVersion(content, row.bodyVersion);
    if (next === content) continue;

    fs.writeFileSync(row.filePath, next);
    changed.push(row);
  }
  return changed;
}

function listSkillFiles(skillsDir) {
  if (!fs.existsSync(skillsDir)) return [];
  const files = [];

  for (const dir of fs.readdirSync(skillsDir).sort()) {
    const skillPath = path.join(skillsDir, dir, "SKILL.md");
    if (fs.existsSync(skillPath)) files.push(skillPath);
  }

  return files;
}

function parseSkill(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { hasFrontmatter: false, frontmatter: {}, body: content };

  const frontmatter = {};
  let currentKey = null;
  let currentValue = "";

  for (const line of match[1].split("\n")) {
    const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (kv) {
      if (currentKey) frontmatter[currentKey] = cleanYamlScalar(currentValue);
      currentKey = kv[1];
      currentValue = kv[2] || "";
      continue;
    }
    if (currentKey && (/^\s+/.test(line) || line.trim() === "")) {
      currentValue += `\n${line}`;
    }
  }
  if (currentKey) frontmatter[currentKey] = cleanYamlScalar(currentValue);

  return {
    hasFrontmatter: true,
    frontmatter,
    body: content.slice(match[0].length),
  };
}

function cleanYamlScalar(value) {
  const trimmed = String(value).trim();
  const marker = String(value).split("\n")[0].trim();
  if (marker === "|" || marker === ">") {
    return String(value)
      .split("\n")
      .slice(1)
      .map((line) => line.trim())
      .filter(Boolean)
      .join(" ");
  }
  return trimmed.replace(/^["']|["']$/g, "");
}

function extractBodyVersion(body) {
  const match = body.match(/^>\s*version:\s*([0-9][^|\n ]*)/m);
  return match ? match[1].trim() : null;
}

function insertFrontmatterVersion(content, version) {
  if (!content.startsWith("---\n")) return content;
  if (/^version:\s*/m.test(content.match(/^---\n([\s\S]*?)\n---/)?.[1] || "")) return content;

  const lines = content.split("\n");
  const insertAt = lines.findIndex((line, index) => index > 0 && line.match(/^description:\s*/));
  const targetIndex = insertAt === -1 ? 1 : insertAt;
  lines.splice(targetIndex, 0, `version: "${version}"`);
  return lines.join("\n");
}

function summarize(plan, changed = []) {
  return {
    total: plan.length,
    existing_frontmatter_version: plan.filter((row) => row.currentVersion).length,
    body_version_candidates: plan.filter((row) => row.bodyVersion && !row.currentVersion).length,
    backfillable: plan.filter((row) => row.action === "backfill").length,
    blocked_missing_history: plan.filter((row) => row.blockedReason === "missing-version-history").length,
    blocked_missing_frontmatter: plan.filter((row) => row.blockedReason === "missing-frontmatter").length,
    changed: changed.length,
    changed_files: changed.map((row) => row.rel),
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return 0;
  }

  const plan = collectVersionBackfillPlan(args.skillsDir, {
    requireVersionHistory: args.requireVersionHistory,
  });
  const changed = args.apply ? applyVersionBackfill(plan) : [];
  const summary = summarize(plan, changed);

  if (args.json) {
    console.log(JSON.stringify({ summary, plan }, null, 2));
  } else {
    const blocked = summary.blocked_missing_history + summary.blocked_missing_frontmatter;
    console.log(`Skill version backfill — ${summary.backfillable} backfillable, ${blocked} blocked, ${summary.existing_frontmatter_version} already versioned`);
    for (const row of plan) {
      if (row.action === "backfill") console.log(`BACKFILL ${row.rel} -> ${row.bodyVersion}`);
      if (row.blockedReason) console.log(`BLOCKED ${row.rel} -> ${row.bodyVersion} (${row.blockedReason})`);
    }
    if (args.apply) console.log(`Applied ${changed.length} skill version update(s)`);
  }

  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
