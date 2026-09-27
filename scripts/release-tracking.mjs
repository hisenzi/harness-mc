#!/usr/bin/env node

import { executePlan, executeApply } from "./lib/release-tracking.mjs";

function printHelp() {
  console.log(`
Usage:
  node scripts/release-tracking.mjs plan --event <path> --contract <path> --result <path> --evidence-root <path> --out <path>
  node scripts/release-tracking.mjs apply --plan <path> --mode fixture --api-base <loopback-url> --state-dir <path> --out <path>

  node scripts/release-tracking.mjs apply --plan <path> --mode live --activation <path> --state-dir <path> --out <path>

Live mode uses https://api.github.com and GITHUB_TOKEN/GH_TOKEN from the environment.
Commands:
  plan      Validate inputs, determine routing, and render message without side effects.
  apply     Execute plan, perform atomic lock, marker check, API post, and readback.

Options:
  --help, -h    Show this help message.
`);
}

function parseArgs(args) {
  const parsed = { command: null, options: {} };
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      parsed.options.help = true;
      i++;
    } else if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        parsed.options[key] = next;
        i += 2;
      } else {
        parsed.options[key] = true;
        i++;
      }
    } else if (!parsed.command) {
      parsed.command = arg;
      i++;
    } else {
      i++;
    }
  }
  return parsed;
}

async function main() {
  const args = process.argv.slice(2);
  const { command, options } = parseArgs(args);

  if (options.help || !command) {
    printHelp();
    process.exit(0);
  }

  if (command === "plan") {
    const { event, contract, result, "evidence-root": evidenceRoot, out } = options;
    if (!event || !contract || !result || !evidenceRoot || !out) {
      console.error("Missing required arguments for plan command.");
      printHelp();
      process.exit(2);
    }

    try {
      const outcome = executePlan({
        eventPath: event,
        contractPath: contract,
        resultPath: result,
        evidenceRoot,
        outDir: out,
      });
      console.log(`Plan succeeded with status: ${outcome.status}`);
      process.exit(outcome.exitCode);
    } catch (err) {
      console.error(`Plan failed: ${err.message}`);
      process.exit(err.exitCode || 2);
    }
  } else if (command === "apply") {
    const { plan, mode = "fixture", "api-base": apiBase, activation: activationPath, "state-dir": stateDir, out } = options;
    if (!plan || (!apiBase && mode === "fixture") || !stateDir || !out) {
      console.error("Missing required arguments for apply command.");
      printHelp();
      process.exit(2);
    }

    try {
      const outcome = await executeApply({
        planPath: plan,
        mode,
        apiBase,
        activationPath,
        stateDir,
        outDir: out,
      });
      console.log(`Apply succeeded with status: ${outcome.status}`);
      process.exit(outcome.exitCode);
    } catch (err) {
      console.error(`Apply failed: ${err.message}`);

      process.exit(err.exitCode || 3);
    }
  } else {
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exit(2);
  }
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(err.exitCode || 1);
});
