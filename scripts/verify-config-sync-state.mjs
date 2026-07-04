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

  fs.writeFileSync(source, "source newer\n");
  fs.writeFileSync(local, "old local\n");
  fs.writeFileSync(skills, "# Skills\n\n`$COLLAB/notyet-harness/000_Agent/skills/demo/SKILL.md`\n");
  fs.utimesSync(local, new Date("2026-07-03T00:00:00Z"), new Date("2026-07-03T00:00:00Z"));
  fs.utimesSync(source, new Date("2026-07-03T01:00:00Z"), new Date("2026-07-03T01:00:00Z"));

  const mismatch = generateConfigSyncState({
    sourcePath: source,
    localPath: local,
    skillsIndexPath: skills,
    duplicateSkillsIndexPath: duplicate,
    outPath,
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
  assert.equal(mismatch.summary.total, 2);
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
    sourcePath: source,
    localPath: local,
    skillsIndexPath: skills,
    duplicateSkillsIndexPath: duplicate,
    outPath,
    generatedAt: "2026-07-03T03:00:00.000Z",
  });
  assert.equal(synced.summary.blocked, 0);
  assert.equal(synced.next_action.type, "none");

  fs.writeFileSync(duplicate, "stale duplicate\n");
  const duplicateState = generateConfigSyncState({
    sourcePath: source,
    localPath: local,
    skillsIndexPath: skills,
    duplicateSkillsIndexPath: duplicate,
    outPath,
    generatedAt: "2026-07-03T04:00:00.000Z",
  });
  assert.equal(duplicateState.checks.find((check) => check.id === "shared_skills_index_path_policy").status, "blocked");

  console.log("Config sync state verification OK");
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}
