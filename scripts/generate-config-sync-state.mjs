import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const collabRoot = path.resolve(root, "..");
const defaultOutPath = path.join(root, "public", "data", "config-sync-state.json");

export function generateConfigSyncState(options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const sourcePath = options.sourcePath || path.join(collabRoot, "notyet-harness", "000_Agent", "docs", "cc-claude-md.md");
  const localPath = options.localPath || path.join(os.homedir(), ".claude", "CLAUDE.md");
  const skillsIndexPath = options.skillsIndexPath || path.join(collabRoot, "notyet-harness", "000_Agent", "skills", "SKILLS-INDEX.md");
  const duplicateSkillsIndexPath = options.duplicateSkillsIndexPath || path.join(collabRoot, "notyet-harness", "000_Agent", "skills", "SKILLS-INDEX (1).md");
  const outPath = options.outPath || defaultOutPath;

  const heartbeatDir = options.heartbeatDir || path.join(collabRoot, "notyet-harness", "schedule", "heartbeat");
  const localHost = options.localHost || os.hostname();

  const source = fileProbe(sourcePath, "$COLLAB/notyet-harness/000_Agent/docs/cc-claude-md.md");
  const local = fileProbe(localPath, "~/.claude/CLAUDE.md");
  const claudeMd = compareClaudeMd(source, local);
  const skills = skillsProbe(skillsIndexPath, duplicateSkillsIndexPath);
  const peerHeartbeat = peerHeartbeatProbe(heartbeatDir, localHost, new Date(generatedAt).getTime());
  const checks = [claudeMd, skills, peerHeartbeat];
  const summary = summarize(checks);

  const data = {
    schema_version: "config-sync-state.v0",
    generated_at: generatedAt,
    read_only: true,
    source: [
      "$COLLAB/notyet-harness/000_Agent/docs/cc-claude-md.md",
      "$COLLAB/notyet-harness/000_Agent/skills/SKILLS-INDEX.md",
      "~/.claude/CLAUDE.md",
    ],
    generator: "$COLLAB/harness-mc/scripts/generate-config-sync-state.mjs",
    output: "$COLLAB/harness-mc/public/data/config-sync-state.json",
    source_of_truth: {
      cc_claude_md: "$COLLAB/notyet-harness/000_Agent/docs/cc-claude-md.md",
      local_mirror: "~/.claude/CLAUDE.md",
      skills_index: "$COLLAB/notyet-harness/000_Agent/skills/SKILLS-INDEX.md",
    },
    source_files: [
      "$COLLAB/harness-mc/scripts/generate-config-sync-state.mjs",
      "$COLLAB/harness-mc/scripts/verify-config-sync-state.mjs",
      "$COLLAB/notyet-harness/000_Agent/docs/cc-claude-md.md",
      "$COLLAB/notyet-harness/000_Agent/skills/SKILLS-INDEX.md",
    ],
    write_boundary: {
      allowed: [
        "read safe metadata",
        "hash configured source and mirror files",
        "check path-policy for shared skills index",
        "write generated config sync read model",
      ],
      forbidden: [
        "print CLAUDE.md contents",
        "read secrets, tokens, cookies, or runtime auth files",
        "copy source to local mirror",
        "modify ~/.claude/CLAUDE.md",
        "modify task state",
      ],
    },
    stale_rule: "Regenerate after cc-claude-md.md edits, local CLAUDE.md cp, skills index edits, startup-chain changes, or dual-machine handoff.",
    summary,
    checks,
    next_action: nextAction(checks),
    verifier_ref: "npm run test:config-sync-state",
  };

  if (options.write !== false) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(data, null, 2)}\n`);
    console.log(`Generated ${outPath} — ${summary.passed}/${summary.total} checks passed, ${summary.blocked} blocked`);
  }

  return data;
}

function fileProbe(filePath, ref) {
  if (!fs.existsSync(filePath)) {
    return { ref, exists: false, size_bytes: null, mtime_ms: null, md5: null };
  }
  const stat = fs.statSync(filePath);
  const content = fs.readFileSync(filePath);
  return {
    ref,
    exists: true,
    size_bytes: stat.size,
    mtime_ms: Math.trunc(stat.mtimeMs),
    md5: crypto.createHash("md5").update(content).digest("hex"),
  };
}

function compareClaudeMd(source, local) {
  let status = "pass";
  let relation = "synced";
  let direction = "none";

  if (!source.exists) {
    status = "blocked";
    relation = "source_missing";
    direction = "restore_source";
  } else if (!local.exists) {
    status = "blocked";
    relation = "local_missing";
    direction = "copy_source_to_local_after_vincent_approval";
  } else if (source.md5 !== local.md5) {
    status = "blocked";
    if ((source.mtime_ms || 0) > (local.mtime_ms || 0)) {
      relation = "source_newer_than_local";
      direction = "copy_source_to_local_after_vincent_approval";
    } else if ((local.mtime_ms || 0) > (source.mtime_ms || 0)) {
      relation = "local_newer_than_source";
      direction = "review_local_before_overwrite";
    } else {
      relation = "hash_mismatch_same_mtime";
      direction = "manual_diff_before_copy";
    }
  }

  return {
    id: "cc_claude_md_mirror",
    status,
    source,
    local,
    relation,
    sync_direction: direction,
    peer_pull_hint: status === "pass" ? null : "After Vincent approves and the local mirror is updated, pull the latest shared source on the peer machine before trusting its local mirror.",
    blocked_on_vincent: status !== "pass",
    next_action: status === "pass"
      ? { type: "none", target: null, label: "Local CLAUDE.md mirror matches source." }
      : { type: "blocked_on_vincent", target: direction, peer_pull_hint: "After approved sync, peer machine should git pull shared source before local copy.", label: "Review md5/mtime metadata before copying; this probe never writes ~/.claude/CLAUDE.md." },
  };
}

function skillsProbe(skillsIndexPath, duplicateSkillsIndexPath) {
  const index = fileProbe(skillsIndexPath, "$COLLAB/notyet-harness/000_Agent/skills/SKILLS-INDEX.md");
  const duplicateExists = fs.existsSync(duplicateSkillsIndexPath);
  const hardcodedPathHits = index.exists
    ? fs.readFileSync(skillsIndexPath, "utf8").split(/\r?\n/).filter((line) => /\/Users\/[A-Za-z]+/.test(line)).length
    : null;
  const status = index.exists && !duplicateExists && hardcodedPathHits === 0 ? "pass" : "blocked";

  return {
    id: "shared_skills_index_path_policy",
    status,
    index,
    duplicate_active_index_exists: duplicateExists,
    hardcoded_user_path_hits: hardcodedPathHits,
    blocked_on_vincent: status !== "pass",
    next_action: status === "pass"
      ? { type: "none", target: null, label: "Shared skills index path policy is clean." }
      : { type: "blocked_on_vincent", target: "skills-index-path-policy", label: "Review skills index path policy before trusting shared skills routing." },
  };
}

// JV-12 雙機同步斷線警報。
// Heartbeat 契約：$COLLAB/notyet-harness/schedule/heartbeat/<host>.json
//   { host, last_run_at, last_pull_at?, head?, written_by }
// 各機每日排程寫自己的檔，隨 git push/pull 跨機同步（push 頻率即 heartbeat 傳輸頻率）。
// 對端檔案超過 48h 未更新 → amber，進哨兵早報；尚無對端檔案（JV-11 未裝）→ unknown，
// next_action 指向 dual-machine-trigger-install，不假 live。
const PEER_STALE_HOURS = 48;

function peerHeartbeatProbe(heartbeatDir, localHost, nowMs) {
  const base = {
    id: "peer_sync_heartbeat",
    heartbeat_dir: "$COLLAB/notyet-harness/schedule/heartbeat",
    local_host: localHost,
    stale_after_hours: PEER_STALE_HOURS,
  };

  const peers = [];
  if (fs.existsSync(heartbeatDir)) {
    for (const name of fs.readdirSync(heartbeatDir).filter((entry) => entry.endsWith(".json")).sort()) {
      try {
        const record = JSON.parse(fs.readFileSync(path.join(heartbeatDir, name), "utf8"));
        if ((record.host || name.replace(/\.json$/, "")) === localHost) continue;
        const lastSeen = record.last_pull_at || record.last_run_at || null;
        const ageHours = lastSeen ? Math.floor((nowMs - new Date(lastSeen).getTime()) / 3600000) : null;
        peers.push({
          host: record.host || name.replace(/\.json$/, ""),
          last_seen_at: lastSeen,
          age_hours: ageHours,
          stale: ageHours === null || ageHours > PEER_STALE_HOURS,
        });
      } catch {
        peers.push({ host: name.replace(/\.json$/, ""), last_seen_at: null, age_hours: null, stale: true, parse_error: true });
      }
    }
  }

  if (peers.length === 0) {
    return {
      ...base,
      status: "unknown",
      peers,
      blocked_on_vincent: false,
      next_action: {
        type: "task",
        target: "dual-machine-trigger-install",
        label: "尚無對端 heartbeat 資料（JV-11 未完成）；MBA-2 裝好排程並首次 push 後本檢查才有訊號。",
      },
    };
  }

  const stalePeers = peers.filter((peer) => peer.stale);
  if (stalePeers.length > 0) {
    return {
      ...base,
      status: "amber",
      peers,
      blocked_on_vincent: false,
      next_action: {
        type: "sentinel_morning_report",
        target: stalePeers.map((peer) => peer.host).join(","),
        label: `對端 ${stalePeers.map((peer) => `${peer.host}（${peer.age_hours === null ? "無時間戳" : `${peer.age_hours}h`}）`).join("、")} 超過 ${PEER_STALE_HOURS}h 未同步——確認該機排程與 git pull 是否活著。`,
      },
    };
  }

  return {
    ...base,
    status: "pass",
    peers,
    blocked_on_vincent: false,
    next_action: { type: "none", target: null, label: "對端 heartbeat 在 48h 窗內。" },
  };
}

function summarize(checks) {
  const blocked = checks.filter((check) => check.status !== "pass").length;
  return {
    total: checks.length,
    passed: checks.length - blocked,
    blocked,
  };
}

function nextAction(checks) {
  const blocked = checks.find((check) => check.status !== "pass");
  if (!blocked) {
    return { type: "none", target: null, label: "Config sync state has no generated action." };
  }
  return blocked.next_action;
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isCli) {
  generateConfigSyncState();
}
