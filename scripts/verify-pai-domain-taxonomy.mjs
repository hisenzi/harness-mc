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

if (fs.existsSync(paiScriptPath)) {
  const paiDomains = extractPaiDomains(fs.readFileSync(paiScriptPath, "utf-8"));
  assert.deepEqual(
    [...new Set(domainIds)].sort(),
    [...new Set(paiDomains)].sort(),
    "taxonomy domains must match heptabase-to-pai.py WHITEBOARDS domain values",
  );
} else {
  console.warn(`PAI script not found; skipped WHITEBOARDS domain cross-check: ${paiScriptPath}`);
}

const activeProjectIds = [];
for (const dir of fs.readdirSync(milestonesDir).sort()) {
  const projectPath = path.join(milestonesDir, dir, "project.json");
  const tasksPath = path.join(milestonesDir, dir, "tasks.json");
  if (!fs.existsSync(projectPath) || !fs.existsSync(tasksPath)) continue;
  const project = readJson(projectPath);
  if ((project.status || "active") === "archived") continue;
  activeProjectIds.push(dir);
}

// provisional_project_domains：他方 session in-flight（本機存在、尚未 commit）的專案 mapping。
// 正向檢查兩邊都認；反向存在檢查只管 project_domains——CI checkout 看不到未 commit 的
// milestone 目錄，寫死在 project_domains 會讓 CI 假紅（2026-07-06 td-morrowise-surface 實證）。
const provisionalDomains = taxonomy.provisional_project_domains || {};
const validDomains = new Set(domainIds);
for (const projectId of activeProjectIds) {
  const mapped = taxonomy.project_domains[projectId] || provisionalDomains[projectId];
  assert.ok(mapped, `${projectId}: missing PAI domain mapping`);
  assert.ok(validDomains.has(mapped), `${projectId}: unknown PAI domain ${mapped}`);
}

for (const projectId of Object.keys(taxonomy.project_domains)) {
  const projectPath = path.join(milestonesDir, projectId, "project.json");
  assert.ok(fs.existsSync(projectPath), `${projectId}: domain mapping points to missing project`);
}

for (const [projectId, domain] of Object.entries(provisionalDomains)) {
  assert.ok(validDomains.has(domain), `${projectId}: unknown provisional PAI domain ${domain}`);
  assert.ok(!taxonomy.project_domains[projectId], `${projectId}: must not be in both project_domains and provisional`);
  if (fs.existsSync(path.join(milestonesDir, projectId, "project.json"))) {
    // 專案已在本機出現：提醒（不阻斷）——待該 milestone commit 後把 mapping 升級進 project_domains
    console.warn(`provisional mapping ${projectId} → ${domain}: promote to project_domains once the milestone is committed`);
  }
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
