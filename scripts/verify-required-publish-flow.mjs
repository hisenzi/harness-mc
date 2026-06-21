#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const collabRoot = path.resolve(process.cwd(), "..");
const notyetRoot = path.join(collabRoot, "notyet-harness");

function read(relativePath) {
  return readFileSync(path.join(notyetRoot, relativePath), "utf8");
}

function includes(file, pattern, label) {
  assert.match(file, pattern, label);
}

const planning = read("000_Agent/skills/vincent-superpowers/02-planning/SKILL.md");
const projectInit = read("000_Agent/skills/project-init/SKILL.md");
const heptabaseSkill = read("000_Agent/skills/heptabase-task-cards/SKILL.md");
const protocol = read("000_Agent/docs/agent-control-plane/visual-layer-transition-protocol.md");
const adapter = read("000_Agent/skills/heptabase-task-cards/scripts/create-task-cards.mjs");

includes(planning, /v1\.7（2026-06-21）：Task 發布 hook 要求先問 Heptabase 白板名稱/, "planning skill history must record the publish-flow gate version");
includes(planning, /先問 Vincent exact Heptabase 白板名稱/, "planning hook must require asking Vincent for the whiteboard");
includes(planning, /不得用 project id、預設白板或搜尋結果推論/, "planning hook must forbid inferred whiteboards");
includes(planning, /Obsidian Canvas 名稱/, "planning hook must bind whiteboard name to Canvas name");

includes(projectInit, /v3\.8（2026-06-21）：開案後 task 發布必須先取得 Vincent 指定的 Heptabase 白板名稱/, "project-init history must record the publish-flow gate version");
includes(projectInit, /不得預設 `MC 儀表版`/, "project-init must not default to MC dashboard whiteboard");
includes(projectInit, /同時作為 Obsidian Canvas 名稱/, "project-init must bind whiteboard name to Canvas name");

includes(heptabaseSkill, /version: 1\.5/, "heptabase-task-cards must record the publish-flow gate version");
includes(heptabaseSkill, /必須停下來問 Vincent/, "heptabase-task-cards must stop and ask when whiteboard is missing");
includes(heptabaseSkill, /不得用 project id、預設白板或搜尋結果推論/, "heptabase-task-cards must forbid inferred whiteboards");
includes(heptabaseSkill, /same whiteboard name/, "coverage report must mention same-name Canvas");

includes(protocol, /Heptabase 白板名稱視為同名 Obsidian Canvas 名稱/, "protocol must define same-name Heptabase and Canvas mapping");
includes(protocol, /不得用 project id、預設白板或搜尋結果推論/, "protocol must forbid inferred whiteboards");
includes(protocol, /source of truth/, "protocol must keep MC as source of truth");

includes(adapter, /export function assertWhiteboardName/, "adapter must expose a whiteboard guard");
includes(adapter, /Ask Vincent for the exact Heptabase whiteboard name/, "adapter must fail with an ask-Vincent message");

const adapterTest = spawnSync(
  process.execPath,
  ["--test", path.join(notyetRoot, "000_Agent/skills/heptabase-task-cards/scripts/create-task-cards.test.mjs")],
  { encoding: "utf8" }
);
if (adapterTest.status !== 0) {
  process.stdout.write(adapterTest.stdout);
  process.stderr.write(adapterTest.stderr);
  process.exit(adapterTest.status ?? 1);
}

console.log("required publish flow verification passed");
