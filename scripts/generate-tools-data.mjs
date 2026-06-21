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
    const changelog = parseChangelog(path.join(dirPath, "CHANGELOG.md"));
    const version = fm.version || extractBodyVersion(content) || changelog[0]?.version || null;
    const category = classifySkill({ dir, fm, content });
    const groups = classifySkillGroups({ dir, fm, content });
    results.push({
      id: dir,
      name: fm.name,
      description: (fm.description || "").replace(/\n/g, " ").slice(0, 200),
      version,
      category,
      groups,
      lastModified: stat.mtime.toISOString(),
      changelog,
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

function extractBodyVersion(content) {
  const match = content.match(/^>\s*version:\s*([0-9][^|\n ]*)/m);
  return match ? match[1].trim() : null;
}

function classifySkill({ dir, fm, content }) {
  const identity = `${dir}\n${fm.name || ""}\n${fm.description || ""}`.toLowerCase();
  const explicit = {
    review: "品質驗收",
    "verification-before-completion": "品質驗收",
    "requesting-code-review": "品質驗收",
    "receiving-code-review": "品質驗收",
    "worktree-commit": "版本控制",
    "git-worktree": "版本控制",
    "using-git-worktrees": "版本控制",
    "heptabase-task-cards": "同步",
    "heptabase-notion-sync": "同步",
    "project-init": "任務管理",
    "planning-preflight": "任務管理",
    "subagent-tracker": "任務管理",
    "schedule-cron": "排程",
    "browser-setup": "瀏覽器",
    "security-scan": "安全",
  };

  if (explicit[dir]) return explicit[dir];
  if (identity.includes("morrowise")) return "MorroWise";
  if (identity.includes("skill")) return "技能系統";
  if (identity.includes("sync") || identity.includes("notion") || identity.includes("obsidian") || identity.includes("heptabase")) return "同步";
  if (identity.includes("project") || identity.includes("task")) return "任務管理";
  if (identity.includes("debug") || identity.includes("bug") || identity.includes("test") || identity.includes("verify")) return "除錯驗證";
  if (identity.includes("write") || identity.includes("article") || identity.includes("blog") || identity.includes("threads")) return "內容寫作";
  return "一般工具";
}

function classifySkillGroups({ dir, fm, content }) {
  const text = `${dir}\n${fm.name || ""}\n${fm.description || ""}\n${content}`.toLowerCase();
  const groups = [];
  const morrowiseSkills = new Set([
    "review",
    "worktree-commit",
    "heptabase-task-cards",
    "heptabase-notion-sync",
    "project-init",
  ]);
  const commitGateSkills = new Set(["worktree-commit", "git-worktree", "using-git-worktrees"]);
  const visualSyncSkills = new Set(["heptabase-task-cards", "heptabase-notion-sync", "project-init"]);

  if (text.includes("morrowise") || morrowiseSkills.has(dir)) {
    groups.push("MorroWise");
  }
  if (text.includes("驗收矩陣") || text.includes("acceptance matrix") || dir === "review") groups.push("驗收規範");
  if (visualSyncSkills.has(dir) || text.includes("visual-layer")) groups.push("視覺層同步");
  if (commitGateSkills.has(dir)) groups.push("Commit gate");

  return [...new Set(groups)];
}

function parseChangelog(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, "utf-8");
  const entries = [];
  let current = null;

  for (const line of content.split("\n")) {
    const versionMatch = line.match(/^- version:\s*"?([^"]+)"?/);
    if (versionMatch) {
      if (current) entries.push(current);
      current = { version: versionMatch[1], date: "", summary: "", details: "", commits: [] };
      continue;
    }
    if (!current) continue;

    const dateMatch = line.match(/^\s+date:\s*"?([^"]+)"?/);
    if (dateMatch) { current.date = dateMatch[1]; continue; }

    const summaryMatch = line.match(/^\s+summary:\s*"?([^"]*)"?/);
    if (summaryMatch) { current.summary = summaryMatch[1]; continue; }

    const detailsMatch = line.match(/^\s+details:\s*"?([^"]*)"?/);
    if (detailsMatch) { current.details = detailsMatch[1]; continue; }

    const commitsMatch = line.match(/^\s+commits:\s*\[([^\]]*)\]/);
    if (commitsMatch) {
      current.commits = commitsMatch[1]
        .split(",")
        .map((s) => s.trim().replace(/"/g, ""))
        .filter(Boolean);
      continue;
    }
  }
  if (current) entries.push(current);
  return entries;
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
