import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const collabRoot = path.resolve(root, "..");
const taxonomyPath = path.join(root, "system-workflow", "registries", "pai-domain-taxonomy.json");
const paiScriptPath = path.join(collabRoot, "notyet-harness", "000_Agent", "scripts", "heptabase-to-pai.py");
const milestonesDir = path.join(root, "milestones");

const taxonomy = readJson(taxonomyPath);
assert.equal(taxonomy.schema_version, "pai-domain-taxonomy.v0");
assert.equal(taxonomy.source_of_truth?.field, "領域");
assert.ok(Array.isArray(taxonomy.domains), "domains must be an array");
assert.ok(taxonomy.project_domains && typeof taxonomy.project_domains === "object", "project_domains must exist");

const domainIds = taxonomy.domains.map((domain) => domain.id);
assert.equal(new Set(domainIds).size, domainIds.length, "domain ids must be unique");

for (const domain of taxonomy.domains) {
  assert.ok(domain.id && domain.label && domain.color, `domain ${domain.id || "(missing)"} must include id/label/color`);
}

const paiDomains = extractPaiDomains(fs.readFileSync(paiScriptPath, "utf-8"));
assert.deepEqual(
  [...new Set(domainIds)].sort(),
  [...new Set(paiDomains)].sort(),
  "taxonomy domains must match heptabase-to-pai.py WHITEBOARDS domain values",
);

const activeProjectIds = [];
for (const dir of fs.readdirSync(milestonesDir).sort()) {
  const projectPath = path.join(milestonesDir, dir, "project.json");
  const tasksPath = path.join(milestonesDir, dir, "tasks.json");
  if (!fs.existsSync(projectPath) || !fs.existsSync(tasksPath)) continue;
  const project = readJson(projectPath);
  if ((project.status || "active") === "archived") continue;
  activeProjectIds.push(dir);
}

const validDomains = new Set(domainIds);
for (const projectId of activeProjectIds) {
  assert.ok(taxonomy.project_domains[projectId], `${projectId}: missing PAI domain mapping`);
  assert.ok(validDomains.has(taxonomy.project_domains[projectId]), `${projectId}: unknown PAI domain ${taxonomy.project_domains[projectId]}`);
}

for (const projectId of Object.keys(taxonomy.project_domains)) {
  const projectPath = path.join(milestonesDir, projectId, "project.json");
  assert.ok(fs.existsSync(projectPath), `${projectId}: domain mapping points to missing project`);
}

console.log(`PAI domain taxonomy verification passed — ${domainIds.length} domains, ${activeProjectIds.length} active projects`);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8").replace(/^﻿/, ""));
}

function extractPaiDomains(source) {
  const block = source.match(/WHITEBOARDS\s*=\s*\{([\s\S]*?)\n\}/)?.[1] || "";
  const domains = [];
  const pattern = /:\s*\(\s*"([^"]+)"/g;
  let match = pattern.exec(block);
  while (match) {
    domains.push(match[1]);
    match = pattern.exec(block);
  }
  return domains;
}
