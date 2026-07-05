import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateConfigSyncState } from "./generate-config-sync-state.mjs";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "config-sync-state-"));

try {
  const source = path.join(tmpRoot, "cc-claude-md.md");
  const local = path.join(tmpRoot, "CLAUDE.md");
  const skills = path.join(tmpRoot, "SKILLS-INDEX.md");
  const duplicate = path.join(tmpRoot, "SKILLS-INDEX (1).md");
  const outPath = path.join(tmpRoot, "config-sync-state.json");
  const heartbeatDir = path.join(tmpRoot, "heartbeat");

  fs.writeFileSync(source, "source newer\n");
  fs.writeFileSync(local, "old local\n");
  fs.writeFileSync(skills, "# Skills\n\n`$COLLAB/notyet-harness/000_Agent/skills/demo/SKILL.md`\n");
  fs.utimesSync(local, new Date("2026-07-03T00:00:00Z"), new Date("2026-07-03T00:00:00Z"));
  fs.utimesSync(source, new Date("2026-07-03T01:00:00Z"), new Date("2026-07-03T01:00:00Z"));

  // 預設 heartbeat：對端 12h 內 → pass，不干擾既有案例
  fs.mkdirSync(heartbeatDir, { recursive: true });
  fs.writeFileSync(
    path.join(heartbeatDir, "peer-mba2.json"),
    `${JSON.stringify({ schema_version: "sync-heartbeat.v0", host: "peer-mba2", last_run_at: "2026-07-02T20:00:00Z" })}\n`,
  );

  const baseOptions = {
    sourcePath: source,
    localPath: local,
    skillsIndexPath: skills,
    duplicateSkillsIndexPath: duplicate,
    outPath,
    heartbeatDir,
    localHost: "local-mba1",
  };

  const mismatch = generateConfigSyncState({
    ...baseOptions,
    generatedAt: "2026-07-03T02:00:00.000Z",
  });

  assert.equal(mismatch.schema_version, "config-sync-state.v0");
  assert.equal(mismatch.read_only, true);
  for (const field of [
    "source",
    "generator",
    "generated_at",
    "stale_rule",
    "next_action",
    "write_boundary",
    "verifier_ref",
  ]) {
    assert.ok(Object.hasOwn(mismatch, field), `missing MC-LIVE-SYS-01 field: ${field}`);
  }
  assert.equal(mismatch.generator, "$COLLAB/harness-mc/scripts/generate-config-sync-state.mjs");
  assert.equal(mismatch.output, "$COLLAB/harness-mc/public/data/config-sync-state.json");
  assert.equal(mismatch.summary.total, 3);
  assert.equal(mismatch.summary.blocked, 1);
  assert.equal(mismatch.checks.find((check) => check.id === "cc_claude_md_mirror").relation, "source_newer_than_local");
  assert.equal(mismatch.checks.find((check) => check.id === "cc_claude_md_mirror").sync_direction, "copy_source_to_local_after_vincent_approval");
  assert.match(mismatch.checks.find((check) => check.id === "cc_claude_md_mirror").peer_pull_hint, /peer machine/);
  assert.equal(mismatch.next_action.type, "blocked_on_vincent");
  assert.match(mismatch.next_action.peer_pull_hint, /peer machine/);
  assert.ok(fs.existsSync(outPath));

  const serialized = JSON.stringify(mismatch);
  assert.doesNotMatch(serialized, /source newer|old local/);
  assert.doesNotMatch(serialized, /\/Users\/[A-Za-z]+/);

  fs.writeFileSync(local, "source newer\n");
  fs.utimesSync(local, new Date("2026-07-03T01:00:00Z"), new Date("2026-07-03T01:00:00Z"));
  const synced = generateConfigSyncState({
    ...baseOptions,
    generatedAt: "2026-07-03T03:00:00.000Z",
  });
  assert.equal(synced.summary.blocked, 0);
  assert.equal(synced.next_action.type, "none");
  assert.equal(synced.checks.find((check) => check.id === "peer_sync_heartbeat").status, "pass");

  fs.writeFileSync(duplicate, "stale duplicate\n");
  const duplicateState = generateConfigSyncState({
    ...baseOptions,
    generatedAt: "2026-07-03T04:00:00.000Z",
  });
  assert.equal(duplicateState.checks.find((check) => check.id === "shared_skills_index_path_policy").status, "blocked");
  fs.rmSync(duplicate);

  // JV-12 heartbeat 案例 1：對端 >48h → amber，next_action 進哨兵早報
  const staleHeartbeat = generateConfigSyncState({
    ...baseOptions,
    generatedAt: "2026-07-05T21:00:00.000Z", // peer last_run 07-02 20:00 → 73h
  });
  const stalePeer = staleHeartbeat.checks.find((check) => check.id === "peer_sync_heartbeat");
  assert.equal(stalePeer.status, "amber");
  assert.equal(stalePeer.next_action.type, "sentinel_morning_report");
  assert.match(stalePeer.next_action.label, /peer-mba2/);
  assert.match(stalePeer.next_action.label, /48h/);

  // JV-12 heartbeat 案例 2：本機自己的檔不算對端 → 無對端資料 → unknown + JV-11 anchor
  const selfOnlyDir = path.join(tmpRoot, "heartbeat-self-only");
  fs.mkdirSync(selfOnlyDir, { recursive: true });
  fs.writeFileSync(
    path.join(selfOnlyDir, "local-mba1.json"),
    `${JSON.stringify({ schema_version: "sync-heartbeat.v0", host: "local-mba1", last_run_at: "2026-07-05T20:00:00Z" })}\n`,
  );
  const noPeer = generateConfigSyncState({
    ...baseOptions,
    heartbeatDir: selfOnlyDir,
    generatedAt: "2026-07-05T21:00:00.000Z",
  });
  const noPeerCheck = noPeer.checks.find((check) => check.id === "peer_sync_heartbeat");
  assert.equal(noPeerCheck.status, "unknown");
  assert.equal(noPeerCheck.next_action.target, "dual-machine-trigger-install");

  // JV-12 heartbeat 案例 3：heartbeat 目錄不存在 → unknown，不假 live
  const missingDir = generateConfigSyncState({
    ...baseOptions,
    heartbeatDir: path.join(tmpRoot, "no-such-heartbeat-dir"),
    generatedAt: "2026-07-05T21:00:00.000Z",
  });
  assert.equal(missingDir.checks.find((check) => check.id === "peer_sync_heartbeat").status, "unknown");

  console.log("Config sync state verification OK — 含 JV-12 heartbeat 三案例");
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}
