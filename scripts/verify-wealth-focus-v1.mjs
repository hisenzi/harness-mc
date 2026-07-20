#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

execFileSync(process.execPath, [path.join(root, "scripts", "generate-data.mjs")], {
  cwd: root,
  stdio: "inherit",
});

const projects = JSON.parse(fs.readFileSync(path.join(root, "public", "data", "projects.json"), "utf8"));
const wealthSystem = projects.find((project) => project.project === "wealth-system");

assert.ok(wealthSystem, "wealth-system must remain in the generated projects read model");
assert.ok(wealthSystem.current_focus, "wealth-system must expose a current_focus card");
assert.match(wealthSystem.current_focus.outcome, /資本配置/, "focus outcome must be output-oriented");
assert.ok(wealthSystem.current_focus.lead_commitment, "focus card must name one lead commitment");
assert.ok(wealthSystem.current_focus.decision_needed, "focus card must name the current decision");
assert.ok(
  wealthSystem.decision_refs.some((ref) => ref.path.includes("safe-leverage-system-design.md")),
  "wealth-system must link the existing safe-leverage decision source",
);

const projectsPage = fs.readFileSync(path.join(root, "app", "projects", "page.tsx"), "utf8");
assert.match(projectsPage, /目前焦點/, "Projects page must render the current focus card");
assert.match(projectsPage, /current_focus/, "Projects page must consume current_focus from the read model");

const notionCourseSync = fs.readFileSync(path.join(root, "scripts", "sync-notion-courses.mjs"), "utf8");
assert.match(notionCourseSync, /服務輸出/, "Notion course sync must read the service-output field");
assert.match(notionCourseSync, /output_ref/, "Notion course sync must persist an output_ref in the MC mirror");

const learningPage = fs.readFileSync(path.join(root, "app", "learning", "page.tsx"), "utf8");
assert.match(learningPage, /服務輸出/, "Learning page must label a linked course by the output it serves");
assert.match(learningPage, /output_ref/, "Learning page must consume output_ref from the course mirror");

console.log("wealth focus v1 verification OK");
