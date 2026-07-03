import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateVerifierSuiteHealth } from "./generate-verifier-suite-health.mjs";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "verifier-suite-health."));
const outPath = path.join(tmpRoot, "verifier-suite-health.json");

try {
  const data = generateVerifierSuiteHealth({
    outPath,
    generatedAt: "2026-07-03T08:30:00.000Z",
    scripts: {
      "test:alpha-pass": "node scripts/alpha-pass.mjs",
      "test:beta-fail": "node scripts/beta-fail.mjs",
      "test:verifier-suite-health": "node scripts/verify-verifier-suite-health.mjs",
    },
    runner: ({ name, cwd }) => {
      if (name === "test:beta-fail") {
        return {
          exit_code: 1,
          duration_ms: 42,
          stdout: `stdout line from ${cwd}\n`,
          stderr: `Assertion failed at ${cwd}/scripts/beta-fail.mjs\n`,
        };
      }
      return {
        exit_code: 0,
        duration_ms: 7,
        stdout: "ok\n",
        stderr: "",
      };
    },
  });

  assert.equal(data.schema_version, "verifier-suite-health.v0");
  assert.equal(data.read_only, true);
  assert.ok(fs.existsSync(outPath), "verifier-suite-health.json should be written");

  for (const field of [
    "source",
    "generator",
    "generated_at",
    "stale_rule",
    "next_action",
    "write_boundary",
    "verifier_ref",
  ]) {
    assert.ok(Object.hasOwn(data, field), `missing MC-LIVE-SYS-01 field: ${field}`);
  }

  assert.equal(data.generator, "$COLLAB/harness-mc/scripts/generate-verifier-suite-health.mjs");
  assert.equal(data.verifier_ref, "npm run test:verifier-suite-health");
  assert.ok(data.write_boundary.forbidden.includes("read secrets"));
  assert.ok(data.write_boundary.forbidden.includes("git commit"));
  assert.ok(data.write_boundary.allowed.includes("execute local test:* verifier commands"));

  assert.equal(data.summary.total, 2);
  assert.equal(data.summary.passed, 1);
  assert.equal(data.summary.failed, 1);
  assert.equal(data.summary.skipped, 1);
  assert.deepEqual(data.summary.skipped_scripts, ["test:verifier-suite-health"]);

  const alpha = data.verifiers.find((item) => item.script === "test:alpha-pass");
  assert.ok(alpha, "passing verifier should be present");
  assert.equal(alpha.status, "pass");
  assert.equal(alpha.failure_excerpt, null);
  assert.equal(alpha.last_run_at, data.generated_at);

  const beta = data.verifiers.find((item) => item.script === "test:beta-fail");
  assert.ok(beta, "failing verifier should be present");
  assert.equal(beta.status, "fail");
  assert.equal(beta.exit_code, 1);
  assert.match(beta.failure_excerpt, /\$COLLAB\/harness-mc\/scripts\/beta-fail\.mjs/);
  assert.doesNotMatch(beta.failure_excerpt, /\/Users\/[A-Za-z]+/);
  assert.equal(data.next_action.type, "fix_failed_verifier");
  assert.equal(data.next_action.target, "test:beta-fail");

  const cleanData = generateVerifierSuiteHealth({
    write: false,
    generatedAt: "2026-07-03T08:31:00.000Z",
    scripts: {
      "test:alpha-pass": "node scripts/alpha-pass.mjs",
      "test:verifier-suite-health": "node scripts/verify-verifier-suite-health.mjs",
    },
    runner: () => ({ exit_code: 0, duration_ms: 5, stdout: "ok\n", stderr: "" }),
  });

  assert.equal(cleanData.summary.failed, 0);
  assert.equal(cleanData.next_action.type, "none");

  console.log("Verifier suite health verification OK");
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}
