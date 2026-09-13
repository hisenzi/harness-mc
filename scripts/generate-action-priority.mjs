#!/usr/bin/env node
import path from "node:path";
import { generateActionPriority } from "./lib/action-priority.mjs";

const args = process.argv.slice(2);
const outArg = args.find((a) => a.startsWith("--out="))?.split("=")[1];
const asOfArg = args.find((a) => a.startsWith("--as-of="))?.split("=")[1];
const dryRun = args.includes("--dry-run");
const jsonOnly = args.includes("--json");
const silent = jsonOnly || args.includes("--silent");

const options = {
  write: !dryRun,
  silent,
};

if (outArg) options.outPath = path.resolve(outArg);
if (asOfArg) options.asOf = asOfArg;

try {
  const result = generateActionPriority(options);
  if (jsonOnly) {
    console.log(JSON.stringify(result, null, 2));
  }
} catch (err) {
  console.error(`Error generating action priority read model: ${err.message}`);
  process.exit(1);
}
