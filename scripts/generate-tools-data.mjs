import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mcDir = path.resolve(__dirname, "..");
const collabDir = path.resolve(mcDir, "..");
const agentDir = path.join(collabDir, "notyet-harness", "000_Agent");
const outPath = path.join(mcDir, "public", "data", "tools.json");

// ── Skills ──────────────────────────────────────────────────────────────

function scanSkills() {
  const skillsDir = path.join(agentDir, "skills");
  if (!fs.existsSync(skillsDir)) return [];

  const results = [];
  for (const dir of fs.readdirSync(skillsDir)) {
    const dirPath = path.join(skillsDir, dir);
    if (!fs.statSync(dirPath).isDirectory()) continue;

    const skillFiles = fs.readdirSync(dirPath).filter((f) => f.startsWith("SKILL") && f.endsWith(".md"));
    if (skillFiles.length === 0) continue;

    const filePath = path.join(dirPath, skillFiles[0]);
    const content = fs.readFileSync(filePath, "utf-8");

    const fm = parseFrontmatter(content);
    if (!fm.name) continue;

    const stat = fs.statSync(filePath);
    results.push({
      id: dir,
      name: fm.name,
      description: (fm.description || "").replace(/\n/g, " ").slice(0, 200),
      version: fm.version || null,
      lastModified: stat.mtime.toISOString(),
    });
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};

  const obj = {};
  let currentKey = null;
  let currentVal = "";

  for (const line of match[1].split("\n")) {
    const kv = line.match(/^(\w[\w-]*):\s*(.*)/);
    if (kv) {
      if (currentKey) obj[currentKey] = currentVal.trim().replace(/^["']|["']$/g, "");
      currentKey = kv[1];
      currentVal = kv[2];
    } else if (currentKey && (line.startsWith("  ") || line.startsWith("\t"))) {
      currentVal += " " + line.trim();
    }
  }
  if (currentKey) obj[currentKey] = currentVal.trim().replace(/^["']|["']$/g, "");
  return obj;
}

// ── Scripts ─────────────────────────────────────────────────────────────

function scanScripts() {
  const sources = [
    { dir: path.join(agentDir, "scripts"), location: "000_Agent" },
    { dir: path.join(mcDir, "scripts"), location: "harness-mc" },
  ];

  const results = [];
  for (const { dir, location } of sources) {
    if (!fs.existsSync(dir)) continue;

    for (const file of fs.readdirSync(dir)) {
      if (file.startsWith(".") || file.endsWith(".example") || file.endsWith(".plist")) continue;
      if (!file.match(/\.(py|sh|mjs|js)$/)) continue;

      const filePath = path.join(dir, file);
      if (!fs.statSync(filePath).isFile()) continue;

      const content = fs.readFileSync(filePath, "utf-8");
      const desc = extractDescription(content, file);
      const stat = fs.statSync(filePath);

      results.push({
        name: file,
        description: desc,
        location,
        lastModified: stat.mtime.toISOString(),
      });
    }
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

function extractDescription(content, filename) {
  // Python docstring
  const pyDoc = content.match(/^["']{3}\n?(.*?)(?:\n|["']{3})/s);
  if (pyDoc) {
    const first = pyDoc[1].split("\n").find((l) => l.trim() && !l.startsWith("#!"));
    if (first) return first.trim().slice(0, 120);
  }
  // Shell comment
  const shComment = content.split("\n").find((l) => l.startsWith("# ") && !l.startsWith("#!"));
  if (shComment) return shComment.replace(/^#\s*/, "").slice(0, 120);
  // JS/MJS first comment or description
  const jsComment = content.match(/\/\/\s*(.+)/);
  if (jsComment) return jsComment[1].slice(0, 120);
  return "";
}

// ── Hooks ───────────────────────────────────────────────────────────────

function scanHooks() {
  const settingsPath = path.join(collabDir, ".claude", "settings.json");
  if (!fs.existsSync(settingsPath)) return [];

  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    const hooks = settings.hooks || {};
    const results = [];

    for (const [event, matchers] of Object.entries(hooks)) {
      for (const matcher of matchers) {
        for (const hook of matcher.hooks || []) {
          results.push({
            event,
            matcher: matcher.matcher || "*",
            type: hook.type || "command",
            command: (hook.command || "").slice(0, 150),
            statusMessage: hook.statusMessage || null,
          });
        }
      }
    }
    return results;
  } catch {
    return [];
  }
}

// ── Recent Changes (git) ────────────────────────────────────────────────

function getRecentChanges() {
  const results = [];

  const repos = [
    { dir: path.join(collabDir, "notyet-harness"), label: "notyet-harness", paths: ["000_Agent/scripts", "000_Agent/skills"] },
    { dir: mcDir, label: "harness-mc", paths: ["scripts"] },
  ];

  for (const { dir, label, paths } of repos) {
    try {
      const pathArgs = paths.join(" ");
      const log = execSync(
        `git log --oneline --no-merges --format="%H|%ai|%s" -20 -- ${pathArgs}`,
        { cwd: dir, encoding: "utf-8", timeout: 5000 }
      ).trim();

      if (!log) continue;

      for (const line of log.split("\n").slice(0, 10)) {
        const [hash, date, ...msgParts] = line.split("|");
        const files = execSync(
          `git diff-tree --no-commit-id --name-only -r ${hash} -- ${pathArgs}`,
          { cwd: dir, encoding: "utf-8", timeout: 5000 }
        ).trim();

        results.push({
          date: date ? date.slice(0, 10) : "",
          message: msgParts.join("|").trim(),
          repo: label,
          files: files ? files.split("\n").slice(0, 5) : [],
        });
      }
    } catch {
      // git not available or not a repo
    }
  }

  return results.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 15);
}

// ── Main ────────────────────────────────────────────────────────────────

const skills = scanSkills();
const scripts = scanScripts();
const hooks = scanHooks();
const recentChanges = getRecentChanges();

const output = {
  generatedAt: new Date().toISOString(),
  summary: {
    totalSkills: skills.length,
    totalScripts: scripts.length,
    totalHooks: hooks.length,
  },
  skills,
  scripts,
  hooks,
  recentChanges,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
console.log(
  `Generated ${outPath} — ${skills.length} skills, ${scripts.length} scripts, ${hooks.length} hooks, ${recentChanges.length} changes`
);
