import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const collabRoot = path.resolve(root, "..");
const skillsRepo = path.join(collabRoot, "notyet-harness");
const defaultSkillsDir = path.join(skillsRepo, "000_Agent", "skills");

function parseArgs(argv) {
  const args = {
    changedOnly: false,
    skillsDir: defaultSkillsDir,
    repo: skillsRepo,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--changed-only") {
      args.changedOnly = true;
    } else if (arg === "--skills-dir") {
      args.skillsDir = path.resolve(argv[++i]);
    } else if (arg === "--repo") {
      args.repo = path.resolve(argv[++i]);
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
    "Usage: node scripts/validate-skills.mjs [--changed-only] [--skills-dir <path>] [--repo <path>]",
    "",
    "Checks shared SKILL.md files for version records and portable paths.",
    "Changed SKILL.md violations fail; existing legacy violations warn.",
  ].join("\n");
}

function runGit(repo, args) {
  return execSync(`git ${args}`, {
    cwd: repo,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function getChangedSkillFiles({ repo, skillsDir }) {
  const changed = new Set();
  const relSkillsDir = path.relative(repo, skillsDir);

  try {
    const tracked = runGit(repo, `diff --name-only HEAD -- ${quoteShell(relSkillsDir)}`);
    for (const file of tracked.split("\n").filter(Boolean)) {
      if (isSkillFile(file)) changed.add(path.resolve(repo, file));
    }
  } catch {
    // Leave changed empty outside a git checkout.
  }

  try {
    const untracked = runGit(repo, `ls-files --others --exclude-standard -- ${quoteShell(relSkillsDir)}`);
    for (const file of untracked.split("\n").filter(Boolean)) {
      if (isSkillFile(file)) changed.add(path.resolve(repo, file));
    }
  } catch {
    // Leave changed empty outside a git checkout.
  }

  return changed;
}

function quoteShell(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function isSkillFile(file) {
  return /(^|\/)SKILL\.md$/i.test(file);
}

function listSkillFiles(skillsDir) {
  if (!fs.existsSync(skillsDir)) return [];
  const files = [];

  for (const dir of fs.readdirSync(skillsDir).sort()) {
    const dirPath = path.join(skillsDir, dir);
    if (!fs.statSync(dirPath).isDirectory()) continue;
    const skillPath = path.join(dirPath, "SKILL.md");
    if (fs.existsSync(skillPath)) files.push(skillPath);
  }

  return files;
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    return { frontmatter: {}, body: content, hasFrontmatter: false };
  }

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
    frontmatter,
    body: content.slice(match[0].length),
    hasFrontmatter: true,
  };
}

function cleanYamlScalar(value) {
  const trimmed = String(value).trim();
  const lines = String(value).split("\n");
  const marker = lines[0].trim();
  if (marker === "|" || marker === ">") {
    return lines
      .slice(1)
      .map((line) => line.trim())
      .filter(Boolean)
      .join(" ");
  }
  return trimmed.replace(/^["']|["']$/g, "");
}

function hasVersionLine(body) {
  return /^>\s*version:\s*\S+/m.test(body);
}

function hasVersionHistory(body) {
  return /^##\s+版本歷史\s*$/m.test(body);
}

function findPortablePathIssues(content) {
  const issues = [];
  const patterns = [
    { re: /\/Users\/[A-Za-z0-9._-]+\//g, label: "hard-coded /Users path" },
    { re: /~\/Downloads\/Claude_協作/g, label: "hard-coded ~/Downloads/Claude_協作 path" },
  ];

  for (const { re, label } of patterns) {
    const seen = new Set();
    for (const match of content.matchAll(re)) {
      if (seen.has(match[0])) continue;
      seen.add(match[0]);
      issues.push(`${label}: ${match[0]}`);
    }
  }

  return issues;
}

export function validateSkillFile(filePath, { changed = false, skillsDir = defaultSkillsDir } = {}) {
  const content = fs.readFileSync(filePath, "utf-8").replace(/^﻿/, "");
  const { frontmatter, body, hasFrontmatter } = parseFrontmatter(content);
  const rel = path.relative(skillsDir, filePath);
  const dirName = path.basename(path.dirname(filePath));
  const problems = [];

  if (!hasFrontmatter) problems.push("missing frontmatter");
  if (!frontmatter.name) problems.push("frontmatter missing name");
  if (!frontmatter.description) {
    problems.push("frontmatter missing concrete description");
  }
  if (!hasVersionLine(body)) problems.push("missing `> version:` line");
  if (!hasVersionHistory(body)) problems.push("missing `## 版本歷史` section");

  for (const issue of findPortablePathIssues(content)) {
    problems.push(issue);
  }

  return {
    filePath,
    rel,
    changed,
    problems,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return 0;
  }

  const changedFiles = getChangedSkillFiles(args);
  const files = args.changedOnly ? [...changedFiles].sort() : listSkillFiles(args.skillsDir);
  const results = files.map((file) => validateSkillFile(file, {
    changed: changedFiles.has(path.resolve(file)),
    skillsDir: args.skillsDir,
  }));

  const errors = [];
  const warnings = [];

  for (const result of results) {
    if (result.problems.length === 0) continue;
    const line = `${result.rel}: ${result.problems.join("; ")}`;
    if (result.changed || args.changedOnly) errors.push(line);
    else warnings.push(line);
  }

  for (const warning of warnings) console.warn(`WARN ${warning}`);
  for (const error of errors) console.error(`ERROR ${error}`);

  if (errors.length > 0) {
    console.error(`Skill validation failed — ${errors.length} changed skill issue(s), ${warnings.length} legacy warning(s)`);
    return 1;
  }

  console.log(`Skill validation OK — ${results.length} checked, ${warnings.length} legacy warning(s)`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
