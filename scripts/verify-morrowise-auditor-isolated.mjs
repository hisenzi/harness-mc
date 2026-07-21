import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "harness-mc-auditor-isolated-"));
const isolatedRoot = path.join(tempRoot, "harness-mc");

try {
  fs.cpSync(root, isolatedRoot, {
    recursive: true,
    filter(source) {
      const relative = path.relative(root, source);
      const topLevel = relative.split(path.sep)[0];
      return ![".git", ".next", "node_modules", ".worktrees"].includes(topLevel);
    },
  });

  const result = spawnSync(process.execPath, ["scripts/generate-morrowise-auditor.mjs"], {
    cwd: isolatedRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `isolated auditor generator failed:\n${result.stderr || result.stdout}`);

  const report = JSON.parse(fs.readFileSync(path.join(isolatedRoot, "public", "data", "morrowise-auditor.json"), "utf8"));
  assert.ok(
    report.findings.some(
      (finding) =>
        finding.category === "source_missing" &&
        finding.evidence_ref === "$COLLAB/notyet-harness/000_Agent/ARCHITECTURE.md",
    ),
    "isolated checkout must report the unavailable external source instead of throwing",
  );
  console.log("MorroWise auditor isolated-checkout verification OK");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
