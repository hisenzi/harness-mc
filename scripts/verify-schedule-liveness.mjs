#!/usr/bin/env node
// Fails when a scheduled job has not actually succeeded on time.
//
// Difference from the neighbouring checks:
//   test:schedule-health  — specs, plists and directories exist
//   test:system-pulse     — pulse script logic, against a temp fixture
//   this one              — real run logs vs each task's cron time
// Only this one turns red when the scheduler silently stops running.
import fs from "node:fs";
import path from "node:path";

const collab = path.resolve(process.env.COLLAB ?? path.join(import.meta.dirname, "..", ".."));
const root = path.join(collab, "notyet-harness", "schedule");
const graceMin = Number(process.argv.find((a) => a.startsWith("--grace-minutes="))?.split("=")[1] ?? 120);
const now = Date.now();

const tasks = fs.readdirSync(path.join(root, "tasks"))
  .filter((f) => f.endsWith(".yaml"))
  .map((f) => {
    const text = fs.readFileSync(path.join(root, "tasks", f), "utf8");
    return {
      id: /^id:\s*(.+)$/m.exec(text)?.[1].trim(),
      cron: /^schedule:\s*"?([^"#\n]+?)"?\s*(?:#.*)?$/m.exec(text)?.[1].trim(),
    };
  });

function lastSuccessAt(id) {
  const dir = path.join(root, "runs");
  if (!fs.existsSync(dir)) return null;
  let best = null;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".log") || !file.startsWith(`${id}-`)) continue;
    let header;
    try { header = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8").split("\n", 1)[0]); } catch { continue; }
    if (header?.task_id !== id || header.status !== "success") continue;
    const at = Date.parse(header.finished_at ?? header.started_at ?? "");
    if (Number.isFinite(at) && (best === null || at > best)) best = at;
  }
  return best;
}

// Most recent scheduled fire time. Supports the daily "<minute> <hour> * * *" form.
function previousFireAt(cron) {
  const [minute, hour, ...rest] = (cron ?? "").split(/\s+/);
  if (rest.length !== 3 || !rest.every((f) => f === "*")) return null;
  if (!/^\d+$/.test(minute ?? "") || !/^\d+$/.test(hour ?? "")) return null;
  const fire = new Date(now);
  fire.setHours(Number(hour), Number(minute), 0, 0);
  if (fire.getTime() > now) fire.setDate(fire.getDate() - 1);
  return fire.getTime();
}

const iso = (ms) => (ms === null ? "never" : new Date(ms).toISOString().replace(/\.\d+Z$/, "Z"));
const rows = tasks.map((task) => {
  const succeeded = lastSuccessAt(task.id);
  const fire = previousFireAt(task.cron);
  let status;
  if (fire === null) status = "unknown_cadence";
  else if (succeeded === null) status = "no_success_recorded";
  else status = succeeded >= (now >= fire + graceMin * 60000 ? fire : fire - 86400000) ? "live" : "stale";
  return { ...task, succeeded, fire, status };
});

for (const row of rows) {
  const mark = row.status === "live" ? "✔" : row.status === "unknown_cadence" ? "…" : "✘";
  console.log(`${mark} ${row.id.padEnd(24)} cron="${row.cron}" due=${iso(row.fire)} last_success=${iso(row.succeeded)} → ${row.status}`);
}

const failed = rows.filter((r) => r.status === "stale" || r.status === "no_success_recorded");
const live = rows.filter((r) => r.status === "live").length;
const unknown = rows.filter((r) => r.status === "unknown_cadence").length;
console.log(`\nschedule liveness: ${live}/${rows.length} live, ${failed.length} failing, ${unknown} unknown cadence (grace ${graceMin}m)`);
if (failed.length > 0) {
  console.error(`FAIL: ${failed.map((r) => `${r.id}=${r.status}`).join(", ")}`);
  console.error("The schedule has not actually run. Check: launchctl list | grep com.hisenzi.schedule");
  process.exit(1);
}
