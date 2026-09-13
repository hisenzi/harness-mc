#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { generateTrustedHeartbeat } from "./lib/trusted-heartbeat.mjs";

const args = process.argv.slice(2);
const outArg = args.find((a) => a.startsWith("--out="))?.split("=")[1];
const dryRun = args.includes("--dry-run");
const jsonOnly = args.includes("--json");
const silent = jsonOnly || args.includes("--silent");
const fixtureOnly = args.includes("--fixture-only");
const nowArg = args.find((a) => a.startsWith("--now="))?.split("=")[1];

const options = {
  write: !dryRun,
  silent,
  fixtureOnly,
};

if (outArg) options.outPath = path.resolve(outArg);
if (nowArg) options.now = nowArg;

try {
  const result = generateTrustedHeartbeat(options);
  if (jsonOnly) {
    console.log(JSON.stringify(result, null, 2));
  }
} catch (err) {
  console.error(`Error generating trusted heartbeat: ${err.message}`);
  process.exit(1);
}
