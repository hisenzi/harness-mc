import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const sourcePath = path.join(root, "tools", "morrowise-notifier", "MorroWiseNotifier.swift");
const readmePath = path.join(root, "tools", "morrowise-notifier", "README.md");
const plistPath = path.join(root, "tools", "morrowise-notifier", "Info.plist");
const source = fs.readFileSync(sourcePath, "utf8");
const readme = fs.readFileSync(readmePath, "utf8");
const plist = fs.readFileSync(plistPath, "utf8");

assert.match(source, /NSOpenPanel/, "Notifier must use a file picker grant");
assert.match(source, /withSecurityScope/, "Notifier must store a security-scoped file bookmark");
assert.match(source, /UNUserNotificationCenter/, "Notifier must use macOS notification API directly");
assert.match(source, /delivered\.sqlite/, "Notifier delivered state must use its own sqlite store");
assert.match(source, /SQLite3/, "Notifier must use sqlite for delivered marks");
assert.match(readme, /Do not grant Full Disk Access/i);
assert.match(readme, /No write-back to `\$COLLAB`/i);
assert.match(readme, /UserNotifications` needs a real bundle identity/i);
assert.match(plist, /com\.hisenzi\.morrowise-notifier/, "Notifier app must have a stable bundle id");
assert.match(plist, /MorroWiseNotifier/, "Notifier app plist must name the executable");

for (const forbidden of [
  "Process(",
  "NSTask",
  "popen(",
  "system(",
  "NSWorkspace",
  "launchctl",
  "/bin/bash",
  "notify.sh",
  "osascript",
]) {
  assert.equal(source.includes(forbidden), false, `Notifier source must not contain ${forbidden}`);
}

const appRoot = path.join(os.tmpdir(), `MorroWiseNotifier-${process.pid}.app`);
const contents = path.join(appRoot, "Contents");
const macOS = path.join(contents, "MacOS");
fs.mkdirSync(macOS, { recursive: true });
fs.copyFileSync(plistPath, path.join(contents, "Info.plist"));
const output = path.join(macOS, "MorroWiseNotifier");
const compile = spawnSync("swiftc", [
  sourcePath,
  "-framework",
  "AppKit",
  "-framework",
  "UserNotifications",
  "-lsqlite3",
  "-o",
  output,
], {
  encoding: "utf8",
  env: {
    ...process.env,
    CLANG_MODULE_CACHE_PATH: path.join(os.tmpdir(), "clang-module-cache"),
  },
});

try {
  assert.equal(compile.status, 0, compile.stderr || compile.stdout);
  assert.equal(fs.existsSync(output), true, "compiled notifier app binary should exist");
  assert.equal(fs.existsSync(path.join(contents, "Info.plist")), true, "compiled notifier app should include Info.plist");
} finally {
  fs.rmSync(appRoot, { recursive: true, force: true });
}

console.log("MorroWise notifier source verification OK");
