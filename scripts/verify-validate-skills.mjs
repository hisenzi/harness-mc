import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { validateSkillFile } from "./validate-skills.mjs";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "validate-skills-"));
const skillsDir = path.join(tmpRoot, "skills");

function writeSkill(name, body) {
  const dir = path.join(skillsDir, name);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, "SKILL.md");
  fs.writeFileSync(filePath, body.trimStart(), "utf-8");
  return filePath;
}

const valid = writeSkill("sample-skill", `---
name: sample-skill
description: |
  測試用 skill。當 Vincent 說「測試 skill」時使用。
---

> version: 1.1 | updated: 2026-06-20 | changes: 測試版本紀錄

# sample-skill

## 版本歷史

- v1.1（2026-06-20）：測試版本紀錄。
- v1.0（2026-06-19）：初版。
`);

const validResult = validateSkillFile(valid, { changed: true, skillsDir });
assert.deepEqual(validResult.problems, []);

const missingHistory = writeSkill("missing-history", `---
name: missing-history
description: 測試用 skill。當 Vincent 說「測試缺版本歷史」時使用。
---

> version: 1.0 | updated: 2026-06-20 | changes: 初版

# missing-history
`);

const missingHistoryResult = validateSkillFile(missingHistory, { changed: true, skillsDir });
assert(missingHistoryResult.problems.includes("missing `## 版本歷史` section"));

const forbiddenPath = ["/Users", "somedesign", "Downloads", "Claude_協作", "notyet-harness"].join("/");
const hardCodedPath = writeSkill("hard-coded-path", `---
name: hard-coded-path
description: 測試用 skill。當 Vincent 說「測試硬編路徑」時使用。
---

> version: 1.0 | updated: 2026-06-20 | changes: 初版

# hard-coded-path

## 版本歷史

- v1.0（2026-06-20）：初版。

讀取 ${forbiddenPath}。
`);

const hardCodedPathResult = validateSkillFile(hardCodedPath, { changed: true, skillsDir });
assert(hardCodedPathResult.problems.some((problem) => problem.includes("hard-coded /Users path")));

console.log("validate-skills verification passed");
