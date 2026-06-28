import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyVersionBackfill, collectVersionBackfillPlan } from "./backfill-skill-frontmatter-versions.mjs";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "skill-version-backfill-"));
const skillsDir = path.join(tmpRoot, "skills");

writeSkill("ready-skill", [
  "---",
  "name: ready-skill",
  "description: Ready skill",
  "---",
  "",
  "# Ready skill",
  "",
  "> version: 1.2",
  "",
  "## 版本歷史",
  "",
].join("\n"));

writeSkill("legacy-skill", [
  "---",
  "name: legacy-skill",
  "description: Legacy skill",
  "---",
  "",
  "# Legacy skill",
  "",
  "> version: 0.9",
  "",
].join("\n"));

writeSkill("no-frontmatter-skill", [
  "# No frontmatter skill",
  "",
  "> version: 0.1",
  "",
  "## 版本歷史",
  "",
].join("\n"));

writeSkill("done-skill", [
  "---",
  "name: done-skill",
  "version: \"2.0\"",
  "description: Done skill",
  "---",
  "",
  "# Done skill",
  "",
  "> version: 2.0",
  "",
  "## 版本歷史",
  "",
].join("\n"));

const gatedPlan = collectVersionBackfillPlan(skillsDir, { requireVersionHistory: true });
assert.equal(gatedPlan.filter((row) => row.action === "backfill").length, 1);
assert.equal(gatedPlan.filter((row) => row.blockedReason === "missing-version-history").length, 1);
assert.equal(gatedPlan.filter((row) => row.blockedReason === "missing-frontmatter").length, 1);
assert.equal(applyVersionBackfill(gatedPlan).length, 1);

const ready = fs.readFileSync(path.join(skillsDir, "ready-skill", "SKILL.md"), "utf-8");
const legacy = fs.readFileSync(path.join(skillsDir, "legacy-skill", "SKILL.md"), "utf-8");
const noFrontmatter = fs.readFileSync(path.join(skillsDir, "no-frontmatter-skill", "SKILL.md"), "utf-8");
const done = fs.readFileSync(path.join(skillsDir, "done-skill", "SKILL.md"), "utf-8");

assert.match(ready, /version: "1\.2"\ndescription:/);
assert.doesNotMatch(legacy, /^version:/m);
assert.doesNotMatch(noFrontmatter, /^version:/m);
assert.match(done, /version: "2\.0"/);

const fullPlan = collectVersionBackfillPlan(skillsDir);
assert.equal(fullPlan.filter((row) => row.action === "backfill").length, 1);
assert.equal(fullPlan.filter((row) => row.blockedReason === "missing-frontmatter").length, 1);

console.log("skill version backfill verification passed");

function writeSkill(name, content) {
  const dir = path.join(skillsDir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), content);
}
