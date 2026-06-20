import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const reportPath = path.join(root, "system-workflow", "docs", "specs", "morrowise-control-console-verify.md");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const report = fs.readFileSync(reportPath, "utf-8");

const requiredSections = [
  "## Source-Of-Truth Answer",
  "## Current Task Map Answer",
  "## Growth Trigger Conditions Answer",
  "## State Pipeline Answer",
  "## Read Model Answer",
  "## Dashboard Surface Answer",
  "## Feedback / Open Loops Answer",
  "## Boundary: Not Proactive Yet",
  "## Verification Commands",
  "## Final Decision",
];

for (const section of requiredSections) {
  assert(report.includes(section), `missing section: ${section}`);
}

const requiredEvidence = [
  "$COLLAB/harness-mc/milestones/harness-mc/tasks.json",
  "morrowise-source-inventory",
  "morrowise-mc-task-map",
  "morrowise-growth-gate-spec",
  "morrowise-anatomy-read-model",
  "morrowise-dashboard-surface",
  "morrowise-trigger-rules-registry",
  "morrowise-recommendation-engine-v0",
  "morrowise-approval-policy",
  "morrowise-autonomous-action-runner-v0",
  "morrowise-proactive-loop-verify",
  "npm run test:morrowise-schema",
  "npm run test:tasks",
  "npm run build",
];

for (const evidence of requiredEvidence) {
  assert(report.includes(evidence), `missing evidence: ${evidence}`);
}

assert(/PASS with explicit boundary/i.test(report), "report must pass with explicit boundary");
assert(/not yet proactive automation/i.test(report), "report must state MorroWise is not proactive yet");
assert(/Do not mark MorroWise proactive or autonomous/i.test(report), "report must prohibit proactive/autonomous claim");

console.log("MorroWise control-console verification report OK");

