import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const collabRoot = path.resolve(root, "..");
const milestonesDir = path.join(root, "milestones");
const decisionsDir = path.join(collabRoot, "notyet-harness", "000_Agent", "decisions");

function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, "utf-8").replace(/^﻿/, ""));
}

function adrIdFromFilename(file) {
  const match = path.basename(file).match(/^(ADR-\d+)/i);
  return match ? match[1].toUpperCase() : null;
}

function parseMetadataLine(content, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content.match(new RegExp(`^- \\*\\*${escaped}:\\*\\*\\s*(.+)$`, "m"));
  return match ? match[1].trim() : "";
}

function parseProjectList(value) {
  if (!value || value.toLowerCase() === "none") return [];
  return value
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
}

function parseAdrs() {
  const map = new Map();
  if (!fs.existsSync(decisionsDir)) return map;

  for (const file of fs.readdirSync(decisionsDir).filter((f) => /^ADR-\d+.*\.md$/i.test(f))) {
    const adr = adrIdFromFilename(file);
    if (!adr) continue;
    const abs = path.join(decisionsDir, file);
    const content = fs.readFileSync(abs, "utf-8");
    const title = (content.match(/^#\s+(.+)$/m)?.[1] || adr).trim();
    const projects = parseProjectList(parseMetadataLine(content, "Projects"));
    map.set(adr, { adr, file, abs, title, projects });
  }
  return map;
}

function parseProjects() {
  const map = new Map();
  for (const dir of fs.readdirSync(milestonesDir)) {
    const projectPath = path.join(milestonesDir, dir, "project.json");
    if (!fs.existsSync(projectPath)) continue;
    const meta = readJSON(projectPath);
    const refs = Array.isArray(meta.decision_refs) ? meta.decision_refs : [];
    map.set(dir, { id: dir, projectPath, refs });
  }
  return map;
}

const adrs = parseAdrs();
const projects = parseProjects();
const errors = [];

if (!fs.existsSync(decisionsDir)) {
  console.warn(`ADR backlink check skipped — decisions directory not found: ${path.relative(root, decisionsDir)}`);
  process.exit(0);
}

for (const adr of adrs.values()) {
  for (const projectId of adr.projects) {
    const project = projects.get(projectId);
    if (!project) {
      errors.push(`${adr.adr} declares project "${projectId}", but milestones/${projectId}/project.json does not exist.`);
      continue;
    }
    const hasBacklink = project.refs.some((ref) => String(ref.adr || "").toUpperCase() === adr.adr);
    if (!hasBacklink) {
      errors.push(`${adr.adr} declares project "${projectId}", but milestones/${projectId}/project.json lacks decision_refs entry.`);
    }
  }
}

for (const project of projects.values()) {
  for (const ref of project.refs) {
    const adr = String(ref.adr || "").toUpperCase();
    if (!adr) {
      errors.push(`milestones/${project.id}/project.json has decision_refs entry without adr.`);
      continue;
    }
    const adrMeta = adrs.get(adr);
    if (!adrMeta) {
      errors.push(`milestones/${project.id}/project.json references ${adr}, but no matching ADR file exists.`);
      continue;
    }
    if (adrMeta.projects.length > 0 && !adrMeta.projects.includes(project.id)) {
      errors.push(`milestones/${project.id}/project.json references ${adr}, but ${adr} Projects metadata does not include "${project.id}".`);
    }
  }
}

if (errors.length) {
  console.error(`ADR backlink check failed (${errors.length}):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

const linked = [...projects.values()].reduce((sum, p) => sum + p.refs.length, 0);
const declared = [...adrs.values()].reduce((sum, a) => sum + a.projects.length, 0);
console.log(`ADR backlink check OK — ${declared} ADR project declarations, ${linked} project decision_refs`);
