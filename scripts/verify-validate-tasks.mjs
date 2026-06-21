import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "validate-tasks-"));
const repo = path.join(tmpRoot, "repo");
const script = path.resolve("scripts", "validate-tasks.mjs");

function run(args, { cwd = repo, expectFailure = false } = {}) {
  try {
    const stdout = execFileSync(process.execPath, [script, ...args], {
      cwd,
      env: { ...process.env, HARNESS_MC_ROOT: repo },
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (expectFailure) throw new Error(`Expected failure but command passed: ${args.join(" ")}`);
    return { status: 0, output: stdout };
  } catch (error) {
    if (!expectFailure) {
      const stderr = error.stderr ? `\n${error.stderr}` : "";
      throw new Error(`Command failed unexpectedly: ${args.join(" ")}${stderr}`);
    }
    return {
      status: error.status || 1,
      output: `${error.stdout || ""}${error.stderr || ""}`,
    };
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function git(args) {
  return execFileSync("git", args, {
    cwd: repo,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

fs.mkdirSync(repo, { recursive: true });
git(["init"]);
git(["config", "user.email", "verify@example.test"]);
git(["config", "user.name", "Task Validator Verify"]);

const baseTasks = {
  tasks: [
    {
      id: "acp-good-task",
      title: "Good ACP task",
      status: "todo",
      track: "control-plane",
      order_label: "ACP-VERIFY-01",
      done_condition: "A valid task has enough fields for any agent to execute.",
      hc_decision: {
        task_scope: "harness-mc/acp-good-task",
        hc_refs: ["#rightProblem", "#risk"],
        hc_reasoning: "Fixture validates that active ACP tasks carry HC framing before execution.",
        hc_confidence: 0.8,
        evidence_refs: ["milestones/harness-mc/tasks.json"],
        source_boundary: "HC is a thinking check, not source of truth; tasks.json remains canonical."
      },
      depends_on: [],
      external_refs: {},
    },
    {
      id: "legacy-missing-fields",
      title: "Legacy missing fields",
      status: "todo",
    },
  ],
};

writeJson(path.join(repo, "milestones", "harness-mc", "tasks.json"), baseTasks);
git(["add", "milestones/harness-mc/tasks.json"]);
git(["commit", "-m", "seed tasks"]);

const clean = run(["--changed-only"]);
if (!clean.output.includes("Task validation OK")) {
  throw new Error("Expected changed-only clean state to pass.");
}

const legacyWarn = run(["--project", "harness-mc"]);
if (!legacyWarn.output.includes("Task validation OK")) {
  throw new Error("Expected full project scan to warn but pass.");
}

const changedTasks = structuredClone(baseTasks);
changedTasks.tasks.push({
  id: "acp-bad-task",
  title: "Bad ACP task",
  status: "todo",
  track: "control-plane",
});
writeJson(path.join(repo, "milestones", "harness-mc", "tasks.json"), changedTasks);

const failed = run(["--changed-only", "--project", "harness-mc"], { expectFailure: true });
if (!failed.output.includes("ERROR milestones/harness-mc/tasks.json task=acp-bad-task")) {
  throw new Error("Expected changed ACP task to fail validation.");
}
if (!failed.output.includes("done_condition must be a non-empty string")) {
  throw new Error("Expected missing done_condition error.");
}
if (!failed.output.includes("order_label is required")) {
  throw new Error("Expected missing order_label error.");
}
if (!failed.output.includes("hc_decision is required")) {
  throw new Error("Expected missing hc_decision error.");
}

const malformedHc = structuredClone(baseTasks);
malformedHc.tasks.push({
  id: "acp-malformed-hc",
  title: "Malformed HC task",
  status: "todo",
  track: "control-plane",
  order_label: "ACP-VERIFY-02",
  done_condition: "Changed system tasks must include a usable HC decision block.",
  hc_decision: {
    task_scope: "harness-mc/acp-malformed-hc",
    hc_refs: ["risk"],
    hc_reasoning: "Missing hash prefix and source boundary contract.",
    hc_confidence: 2,
    evidence_refs: [],
    source_boundary: "HC helps."
  }
});
writeJson(path.join(repo, "milestones", "harness-mc", "tasks.json"), malformedHc);

const malformedFailed = run(["--changed-only", "--project", "harness-mc"], { expectFailure: true });
if (!malformedFailed.output.includes("hc_decision.hc_refs entries must be HC refs like #risk")) {
  throw new Error("Expected malformed HC refs error.");
}
if (!malformedFailed.output.includes("hc_decision.source_boundary must mention thinking check and source of truth")) {
  throw new Error("Expected source boundary error.");
}
if (!malformedFailed.output.includes("hc_decision.hc_confidence must be a number from 0 to 1")) {
  throw new Error("Expected HC confidence range error.");
}

console.log("validate-tasks verification OK");
