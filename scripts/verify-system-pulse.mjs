import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "system-pulse-"));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

try {
  const result = spawnSync(process.execPath, ["scripts/run-system-pulse.mjs", "--dry-run"], {
    cwd: root,
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /^prebuild\tnpm run prebuild/m);
  assert.match(result.stdout, /^npm:test:tasks\tnpm run test:tasks/m);
  assert.match(result.stdout, /^sync:morrowise-manual\tpython3 /m);
  assert.match(result.stdout, /^sync:architecture-current-state\tpython3 /m);
  assert.match(result.stdout, /^sync:architecture-subsystems\tpython3 /m);
  assert.match(result.stdout, /sync-architecture-subsystems\.py --check/);
  assert.match(result.stdout, /^task-events:report\tnode scripts\/generate-task-event-data\.mjs/m);
  assert.match(result.stdout, /task_events_mode=report/);
  assert.doesNotMatch(result.stdout, /schedule\/\.env/);
  assert.doesNotMatch(result.stdout, /TELEGRAM_BOT_TOKEN|TELEGRAM_CHAT_ID/);

  const scriptText = fs.readFileSync("scripts/run-system-pulse.mjs", "utf8");
  assert.match(scriptText, /MORROWISE_NOTYET_ROOT/, "System Pulse must support an explicit notyet worktree root for isolated verification");
  assert.match(scriptText, /--system-json/, "System Pulse must pass its explicit current-state read model to the marker sync");
  assert.match(scriptText, /--registry-json/, "System Pulse must pass its explicit Architecture Admission Registry to the marker sync");
  assert.match(scriptText, /SYSTEM_PULSE_APPLY_TASK_EVENTS/);
  assert.match(scriptText, /system-pulse\.v0/);
  assert.match(scriptText, /sync:architecture-subsystems/);
  assert.match(scriptText, /repairCommandForStep/);
  assert.match(scriptText, /sync-architecture-subsystems\.py/);
  assert.match(scriptText, /notify\.sh/);
  assert.match(scriptText, /skipped_missing_env/);

  console.log("System pulse verification OK");
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}
