import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { finalizePulseNotification } from "./system-pulse-notification.mjs";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "system-pulse-"));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0;
let sequence = 0;
const gate = "task-events:pending-gate";
const timestamp = (n) => new Date(Date.UTC(2026, 10, 13, 0, n)).toISOString();
function report(failures = [], minute = 1, pending = 0) {
  const ids = [...new Set(["npm:test:a", "npm:test:b", "npm:test:c", ...failures])];
  return {
    schema_version: "system-pulse.v0", finished_at: timestamp(minute),
    status: failures.length ? "degraded" : "healthy",
    steps: ids.map((id) => ({ id, status: failures.includes(id) ? "fail" : "pass" })),
    summary: { total: ids.length, passed: ids.length - failures.length, failed: failures.length },
    task_event_state: { task_events: { pending } },
  };
}
function fixture(publish = false) {
  const statePath = path.join(tmpRoot, `case-${sequence++}`, "state.json");
  const reportPath = publish ? path.join(path.dirname(statePath), "report.json") : undefined;
  const calls = [];
  const send = (decision) => { calls.push(decision); return { status: "sent", exit_code: 0 }; };
  const run = (current, previousReport, transport = send) => finalizePulseNotification({ report: current, previousReport, statePath, reportPath, send: transport });
  return { statePath, reportPath, calls, run, state: () => JSON.parse(fs.readFileSync(statePath, "utf8")) };
}
function test(name, fn) { fn(); passed += 1; console.log(`PASS ${name}`); }

try {
  test("dry-run retains the complete check plan", () => {
    const result = spawnSync(process.execPath, ["scripts/run-system-pulse.mjs", "--dry-run"], { cwd: root, encoding: "utf8", env: { ...process.env, SYSTEM_PULSE_APPLY_TASK_EVENTS: "0" } });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^prebuild\tnpm run prebuild/m);
    assert.match(result.stdout, /^npm:test:tasks\tnpm run test:tasks/m);
    assert.match(result.stdout, /^sync:morrowise-manual\tpython3 /m);
    assert.match(result.stdout, /^sync:architecture-current-state\tpython3 /m);
    assert.match(result.stdout, /^sync:architecture-subsystems\tpython3 /m);
    assert.match(result.stdout, /sync-architecture-subsystems\.py --check/);
    assert.match(result.stdout, /^task-events:report\tnode scripts\/generate-task-event-data\.mjs/m);
    assert.match(result.stdout, /task_events_mode=report/);
    assert.doesNotMatch(result.stdout, /schedule\/\.env|TELEGRAM_BOT_TOKEN|TELEGRAM_CHAT_ID/);
  });
  test("legacy report seeds unchanged failures silently", () => {
    const f = fixture();
    assert.equal(f.run(report(["npm:test:a"], 2), report(["npm:test:a"], 1)).reason, "unchanged_or_improved");
    assert.equal(f.calls.length, 0);
    assert.deepEqual(f.state().snapshot.failures, ["npm:test:a"]);
  });
  test("new failed ID sends once and reserves before transport", () => {
    const f = fixture(); let calls = 0;
    const result = f.run(report(["npm:test:a"], 2), report([], 1), (decision) => {
      calls += 1;
      assert.deepEqual(decision.new_failures, ["npm:test:a"]);
      assert.deepEqual(decision.worsened, ["healthy_to_degraded"]);
      assert.equal(f.state().last_attempt.status, "pending");
      assert.deepEqual(f.state().snapshot.failures, ["npm:test:a"]);
      assert.ok(fs.existsSync(`${f.statePath}.lock`));
      return { status: "sent", exit_code: 0, stdout_excerpt: "must not persist transport output" };
    });
    assert.equal(result.status, "sent"); assert.equal(calls, 1);
    assert.equal(f.state().last_attempt.status, "sent");
    assert.equal(f.state().last_attempt.stdout_excerpt, undefined);
    assert.ok(!fs.existsSync(`${f.statePath}.lock`));
  });
  test("sorting, excerpts, exit numbers and proposal escalation do not re-notify", () => {
    const f = fixture(); f.run(report(["npm:test:a", "npm:test:b"], 2), report([], 1));
    const changed = report(["npm:test:b", "npm:test:a"], 3);
    changed.steps.reverse(); changed.steps[0].exit_code = 99;
    changed.steps[0].stderr_excerpt = "different text";
    changed.proposals = { escalated: 2, created: 0, pending_decision: 2 };
    assert.equal(f.run(changed).status, "silent"); assert.equal(f.calls.length, 1);
  });
  test("same failure count with a different failed ID still sends", () => {
    const f = fixture();
    const result = f.run(report(["npm:test:b"], 2), report(["npm:test:a"], 1));
    assert.equal(result.status, "sent"); assert.deepEqual(result.new_failures, ["npm:test:b"]); assert.equal(f.calls.length, 1);
  });
  test("partial recovery and complete recovery are silent; recurrence is new", () => {
    const f = fixture(); f.run(report(["npm:test:a", "npm:test:b"], 2), report([], 1));
    assert.equal(f.run(report(["npm:test:a"], 3)).status, "silent");
    assert.equal(f.run(report([], 4)).reason, "healthy");
    assert.deepEqual(f.state().snapshot.failures, []);
    assert.equal(f.run(report(["npm:test:a"], 5)).status, "sent"); assert.equal(f.calls.length, 2);
  });
  test("partially recovered failed ID is detected when it returns", () => {
    const f = fixture(); f.run(report(["npm:test:a"], 2), report(["npm:test:a", "npm:test:b"], 1));
    assert.deepEqual(f.run(report(["npm:test:a", "npm:test:b"], 3)).new_failures, ["npm:test:b"]); assert.equal(f.calls.length, 1);
  });
  test("pending gate increase sends; stable/decreased backlog remains silent", () => {
    const f = fixture();
    const result = f.run(report([gate], 2, 3), report([gate], 1, 2));
    assert.equal(result.status, "sent"); assert.deepEqual(result.new_failures, []);
    assert.deepEqual(result.worsened, ["pending_task_events_increased"]);
    assert.equal(f.run(report([gate], 3, 3)).status, "silent");
    assert.equal(f.run(report([gate], 4, 1)).status, "silent");
    assert.equal(f.run(report([gate], 5, 2)).status, "sent"); assert.equal(f.calls.length, 2);
  });
  test("unknown pending count is not an increase; gate must fail on both runs", () => {
    for (const value of [-1, null, "2"]) {
      const f = fixture(); assert.equal(f.run(report([gate], 2, 5), report([gate], 1, value)).status, "silent"); assert.equal(f.calls.length, 0);
    }
    const f = fixture(); assert.equal(f.run(report(["npm:test:a"], 2, 10), report(["npm:test:a"], 1, 1)).status, "silent");
  });
  test("missing baseline initializes without inventing a new incident", () => {
    const f = fixture(); assert.equal(f.run(report(["npm:test:a"])).reason, "baseline_initialized"); assert.equal(f.calls.length, 0);
  });
  test("corrupt or invalid baseline reinitializes without using a stale legacy seed", () => {
    for (const content of ["{broken", JSON.stringify({ schema_version: "wrong" })]) {
      const f = fixture(); fs.mkdirSync(path.dirname(f.statePath), { recursive: true }); fs.writeFileSync(f.statePath, content);
      assert.equal(f.run(report(["npm:test:a"], 2), report([], 1)).reason, "baseline_invalid"); assert.equal(f.calls.length, 0);
      assert.deepEqual(f.state().snapshot.failures, ["npm:test:a"]);
    }
  });
  test("failed transport is retained and does not retry an unchanged incident", () => {
    const f = fixture(); let calls = 0;
    const result = f.run(report(["npm:test:a"], 2), report([], 1), () => { calls += 1; return { status: "failed", exit_code: 1 }; });
    assert.equal(result.status, "failed"); assert.equal(f.state().last_attempt.status, "failed");
    assert.equal(f.run(report(["npm:test:a"], 3), undefined, () => { calls += 1; }).status, "silent"); assert.equal(calls, 1);
    assert.equal(f.state().last_attempt.status, "failed");
  });
  test("throwing or malformed transport yields unknown and is not retried", () => {
    for (const transport of [() => { throw new Error("private error content"); }, () => ({ status: "unrecognized" })]) {
      const f = fixture(); let calls = 0;
      assert.equal(f.run(report(["npm:test:a"], 2), report([], 1), () => { calls += 1; return transport(); }).status, "unknown");
      assert.equal(f.run(report(["npm:test:a"], 3), undefined, () => { calls += 1; }).status, "silent"); assert.equal(calls, 1);
      assert.doesNotMatch(fs.readFileSync(f.statePath, "utf8"), /private error content/);
    }
  });
  test("pending reservation after interrupted delivery is never replayed", () => {
    const f = fixture(); f.run(report(["npm:test:a"], 2), report([], 1));
    const state = f.state(); state.last_attempt.status = "pending"; fs.writeFileSync(f.statePath, JSON.stringify(state));
    assert.equal(f.run(report(["npm:test:a"], 3)).status, "silent"); assert.equal(f.calls.length, 1);
    assert.equal(f.state().last_attempt.status, "pending");
  });
  test("same or older observation cannot roll back the baseline", () => {
    const f = fixture(); f.run(report(["npm:test:a"], 3), report([], 1)); const before = fs.readFileSync(f.statePath, "utf8");
    for (const minute of [3, 2]) assert.equal(f.run(report(["npm:test:b"], minute)).reason, "stale_observation");
    assert.equal(fs.readFileSync(f.statePath, "utf8"), before); assert.equal(f.calls.length, 1);
  });
  test("concurrent lock blocks transport and leaves its owner's lock in place", () => {
    const f = fixture(); fs.mkdirSync(path.dirname(f.statePath), { recursive: true }); fs.writeFileSync(`${f.statePath}.lock`, "owner");
    assert.equal(f.run(report(["npm:test:a"], 2), report([], 1)).reason, "lock_unavailable");
    assert.equal(f.calls.length, 0); assert.equal(fs.readFileSync(`${f.statePath}.lock`, "utf8"), "owner");
  });
  test("baseline read failure blocks transport", () => {
    const f = fixture(); fs.mkdirSync(f.statePath, { recursive: true });
    assert.equal(f.run(report(["npm:test:a"], 2), report([], 1)).reason, "baseline_unreadable"); assert.equal(f.calls.length, 0);
  });
  test("failed state reservation blocks transport and releases the lock", () => {
    const f = fixture(); const original = fs.renameSync;
    try {
      fs.renameSync = () => { throw Object.assign(new Error("fixture write failure"), { code: "EACCES" }); };
      assert.equal(f.run(report(["npm:test:a"], 2), report([], 1)).reason, "state_write_failed");
    } finally { fs.renameSync = original; }
    assert.equal(f.calls.length, 0); assert.ok(!fs.existsSync(`${f.statePath}.lock`));
    assert.deepEqual(fs.readdirSync(path.dirname(f.statePath)), []);
  });
  test("receipt write failure keeps pending reservation; same incident is silent", () => {
    const f = fixture(); const original = fs.renameSync; let renames = 0;
    try {
      fs.renameSync = (...args) => { if (++renames === 2) throw new Error("fixture receipt failure"); return original(...args); };
      assert.equal(f.run(report(["npm:test:a"], 2), report([], 1)).reason, "receipt_write_failed");
    } finally { fs.renameSync = original; }
    assert.equal(f.state().last_attempt.status, "pending");
    assert.equal(f.run(report(["npm:test:a"], 3)).status, "silent"); assert.equal(f.calls.length, 1);
  });
  test("invalid reports cannot modify state or send", () => {
    for (const invalid of [null, { ...report(["npm:test:a"]), summary: { total: 3, passed: 3, failed: 0 } }, { ...report([]), steps: [null] }]) {
      const f = fixture(); assert.equal(f.run(invalid).reason, "invalid_report"); assert.equal(f.calls.length, 0); assert.ok(!fs.existsSync(f.statePath));
    }
  });

  test("public pending evidence exists before transport, then outcome is published", () => {
    const f = fixture(true); let calls = 0;
    assert.equal(f.run(report(["npm:test:a"], 2), report([], 1), () => {
      calls += 1;
      const published = JSON.parse(fs.readFileSync(f.reportPath, "utf8"));
      assert.equal(published.notification.status, "pending");
      assert.equal(published.notification.attempt_id, f.state().last_attempt.attempt_id);
      assert.equal(published.finished_at, timestamp(2));
      const before = fs.readFileSync(f.reportPath, "utf8");
      assert.equal(f.run(report(["npm:test:b"], 3)).reason, "lock_unavailable");
      assert.equal(fs.readFileSync(f.reportPath, "utf8"), before);
      return { status: "sent", exit_code: 0 };
    }).status, "sent");
    assert.equal(calls, 1); assert.equal(JSON.parse(fs.readFileSync(f.reportPath, "utf8")).notification.status, "sent");
  });
  test("old observations preserve the newer public report and baseline", () => {
    const f = fixture(true); f.run(report(["npm:test:a"], 3), report([], 1));
    const beforeReport = fs.readFileSync(f.reportPath, "utf8"); const beforeState = fs.readFileSync(f.statePath, "utf8");
    assert.equal(f.run(report(["npm:test:b"], 2)).reason, "stale_observation");
    assert.equal(fs.readFileSync(f.reportPath, "utf8"), beforeReport);
    assert.equal(fs.readFileSync(f.statePath, "utf8"), beforeState); assert.equal(f.calls.length, 1);
  });
  test("public report write failure blocks sending and retains the reservation", () => {
    const f = fixture(true); fs.mkdirSync(f.reportPath, { recursive: true });
    assert.equal(f.run(report(["npm:test:a"], 2), report([], 1)).reason, "report_write_failed");
    assert.equal(f.calls.length, 0); assert.equal(f.state().last_attempt.status, "pending");
    assert.ok(!fs.existsSync(`${f.statePath}.lock`));
  });
  test("failed final report publication is unknown and does not resend", () => {
    const f = fixture(true); const original = fs.renameSync; let publications = 0;
    try {
      fs.renameSync = (...args) => {
        if (args[1] === f.reportPath && ++publications === 2) throw new Error("fixture publication failure");
        return original(...args);
      };
      assert.equal(f.run(report(["npm:test:a"], 2), report([], 1)).reason, "report_receipt_write_failed");
    } finally { fs.renameSync = original; }
    assert.equal(f.state().last_attempt.status, "sent");
    assert.equal(JSON.parse(fs.readFileSync(f.reportPath, "utf8")).notification.status, "pending");
    assert.equal(f.run(report(["npm:test:a"], 3)).status, "silent"); assert.equal(f.calls.length, 1);
  });

  // Execute the real runner in a disposable layout. Every subprocess executable
  // resolves to a local fixture; no real npm checks, Python sync or Telegram runs.
  const fixtureRoot = path.join(tmpRoot, "runner", "harness-mc");
  const fixtureScripts = path.join(fixtureRoot, "scripts");
  const fakeBin = path.join(tmpRoot, "runner", "bin");
  const trace = path.join(tmpRoot, "runner", "trace.jsonl");
  const delivery = path.join(tmpRoot, "runner", "delivery.jsonl");
  const proposals = path.join(tmpRoot, "runner", "proposals.jsonl");
  const runnerState = path.join(fixtureRoot, ".runtime", "system-pulse-notification.json");
  const runnerReport = path.join(fixtureRoot, "public", "data", "system-pulse.json");
  fs.mkdirSync(fixtureScripts, { recursive: true }); fs.mkdirSync(fakeBin, { recursive: true }); fs.mkdirSync(path.dirname(runnerReport), { recursive: true });
  for (const filename of ["run-system-pulse.mjs", "system-pulse-notification.mjs"]) fs.copyFileSync(path.join(root, "scripts", filename), path.join(fixtureScripts, filename));
  fs.writeFileSync(path.join(fixtureRoot, "package.json"), JSON.stringify({ scripts: { "test:alpha": "fixture", "test:beta": "fixture" } }));
  fs.writeFileSync(path.join(fixtureScripts, "generate-task-event-data.mjs"), "export function generateTaskEventPipelineData() { return { task_events: { pending: 0 }, sync_events: { pending: 0 }, latest_reducer_run: null }; }\n");
  fs.writeFileSync(path.join(fixtureScripts, "pulse-proposal-queue.mjs"), `import fs from 'node:fs'; export function processPulseProposals({ report }) { fs.appendFileSync(process.env.PULSE_FIXTURE_PROPOSALS, JSON.stringify({status:report.status})+'\\n'); return { created: [], escalated: [{severity:'red'}], pushMessage: 'must not bypass notification gate', readModel: { counts: {pending_decision:0}, oldest_pending_days:0 } }; }\n`);
  const notify = path.join(tmpRoot, "runner", "notyet-harness", "schedule", "lib", "notify.sh"); fs.mkdirSync(path.dirname(notify), { recursive: true }); fs.writeFileSync(notify, "# fixture only; fake bash never executes this file\n");
  const executable = `#!${process.execPath}\nimport fs from 'node:fs'; import path from 'node:path'; const command=path.basename(process.argv[1]); const args=process.argv.slice(2); if(command==='npm' && args[1]==='prebuild') fs.writeFileSync(process.env.PULSE_FIXTURE_REPORT, '{}'); fs.appendFileSync(process.env.PULSE_FIXTURE_TRACE,JSON.stringify({command,args})+'\\n'); if(command==='bash'){ fs.appendFileSync(process.env.PULSE_FIXTURE_DELIVERY,JSON.stringify({message:args[1]})+'\\n'); process.exit(0); } process.exit(command==='npm' && args[1]===process.env.PULSE_FIXTURE_FAILURE ? 1 : 0);\n`;
  for (const name of ["npm", "node", "python3", "bash"]) fs.writeFileSync(path.join(fakeBin, name), executable, { mode: 0o755 });
  const runnerEnv = { ...process.env, PATH: fakeBin, SYSTEM_PULSE_APPLY_TASK_EVENTS: "0", SYSTEM_PULSE_ALLOW_PENDING: "0", PULSE_FIXTURE_TRACE: trace, PULSE_FIXTURE_DELIVERY: delivery, PULSE_FIXTURE_PROPOSALS: proposals, PULSE_FIXTURE_REPORT: runnerReport };
  const lines = (file) => fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
  const executeRunner = (failure = "", args = []) => spawnSync(process.execPath, [path.join(fixtureScripts, "run-system-pulse.mjs"), ...args], { cwd: fixtureRoot, encoding: "utf8", env: { ...runnerEnv, PULSE_FIXTURE_FAILURE: failure } });
  fs.writeFileSync(runnerReport, JSON.stringify({ ...report([], 0), finished_at: "2000-01-01T00:00:00.000Z" }));
  test("runner dry-run causes no check, proposal, state or adapter side effects", () => {
    const before = fs.readFileSync(runnerReport, "utf8"); const result = executeRunner("test:alpha", ["--dry-run"]);
    assert.equal(result.status, 0, result.stderr); assert.deepEqual(lines(trace), []); assert.deepEqual(lines(proposals), []); assert.deepEqual(lines(delivery), []);
    assert.ok(!fs.existsSync(runnerState)); assert.equal(fs.readFileSync(runnerReport, "utf8"), before);
  });
  test("runner retains all checks, failure exit/report and sends only the new failure", () => {
    const result = executeRunner("test:alpha"); assert.equal(result.status, 1, result.stderr);
    const saved = JSON.parse(fs.readFileSync(runnerReport, "utf8")); assert.equal(saved.status, "degraded"); assert.equal(saved.summary.total, 7); assert.equal(saved.summary.failed, 1); assert.equal(saved.notification.status, "sent");
    assert.deepEqual(saved.notification.new_failures, ["npm:test:alpha"]); assert.equal(lines(delivery).length, 1); assert.equal(lines(proposals).length, 1);
    assert.match(lines(delivery)[0].message, /new=npm:test:alpha/); assert.doesNotMatch(lines(delivery)[0].message, /must not bypass/);
    assert.equal(lines(trace).filter((entry) => entry.command !== "bash").length, 7);
  });
  test("runner unchanged failure still checks and exits 1 but never calls adapter", () => {
    const result = executeRunner("test:alpha"); assert.equal(result.status, 1, result.stderr);
    assert.equal(JSON.parse(fs.readFileSync(runnerReport, "utf8")).notification.status, "silent");
    assert.equal(lines(delivery).length, 1); assert.equal(lines(proposals).length, 2); assert.equal(lines(trace).filter((entry) => entry.command !== "bash").length, 14);
  });
  test("runner recovery exits 0 silently; subsequent new failure sends", () => {
    const recovered = executeRunner(); assert.equal(recovered.status, 0, recovered.stderr);
    assert.equal(JSON.parse(fs.readFileSync(runnerReport, "utf8")).notification.reason, "healthy"); assert.equal(lines(delivery).length, 1);
    const recurrence = executeRunner("test:beta"); assert.equal(recurrence.status, 1, recurrence.stderr);
    assert.deepEqual(JSON.parse(fs.readFileSync(runnerReport, "utf8")).notification.new_failures, ["npm:test:beta"]);
    assert.equal(lines(delivery).length, 2); assert.equal(lines(proposals).length, 4); assert.equal(lines(trace).filter((entry) => entry.command !== "bash").length, 28);
  });
  console.log(`System pulse verification OK (${passed} behavioral cases; offline transport only)`);
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}
