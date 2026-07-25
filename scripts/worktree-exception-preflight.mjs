#!/usr/bin/env node

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const VALID_INTENTS = new Set(["implementation", "verification"]);

const EXCEPTIONS = {
  concurrent_active_work: {
    recommended_mode: "worktree",
    next_action: "建立 worktree 前，記錄兩條 active work 的 branch、task 與寫入範圍，並通過 Project Topology gate。",
  },
  urgent_hotfix_with_uncommitted_work: {
    decision: "allow",
    recommended_mode: "worktree",
    next_action: "以暫時 worktree 處理 hotfix；完成後驗證、提交並收尾該隔離工作區。",
  },
  explicit_vincent_request: {
    decision: "allow",
    recommended_mode: "worktree",
    next_action: "記錄 Vincent 的隔離指示，並在建立前通過 Project Topology gate。",
  },
  fresh_baseline_verification: {
    decision: "allow",
    recommended_mode: "verification_only_worktree",
    next_action: "僅在乾淨 worktree 執行驗證；不得在其中實作功能或擴大 scope。",
    allowed_intent: "verification",
  },
};

const NON_EXCEPTIONS = {
  sequential_single_task: {
    recommended_mode: "branch",
    next_action: "在同一工作目錄使用一般 branch，依 scope manifest 保留單一序列工作線。",
  },
  known_unrelated_dirty: {
    recommended_mode: "branch_with_exclusions",
    next_action: "保留已知無關 dirty 檔，列入 exclusions，並只 stage/commit 本次 scope。",
  },
  unknown_or_overlapping_dirty: {
    recommended_mode: "classify_or_escalate",
    next_action: "先分類 dirty ownership；同檔重疊或 owner 不明時請 Vincent 裁決，不得以 worktree 繞過。",
  },
};

function blocked({ reason, intent, recommendedMode, nextAction }) {
  return {
    decision: "blocked",
    worktree_allowed: false,
    reason,
    intent,
    recommended_mode: recommendedMode,
    next_action: nextAction,
  };
}

export function decideWorktreeMode({ reason, intent, evidenceRef = "" }) {
  if (!VALID_INTENTS.has(intent)) {
    throw new Error(`unsupported worktree intent: ${intent || "(missing)"}`);
  }
  const normalizedEvidenceRef = typeof evidenceRef === "string" ? evidenceRef.trim() : "";

  const exception = EXCEPTIONS[reason];
  if (exception) {
    if (exception.allowed_intent && intent !== exception.allowed_intent) {
      return blocked({
        reason,
        intent,
        recommendedMode: exception.recommended_mode,
        nextAction: `${exception.next_action} 目前 intent=${intent}，請改用一般 branch 實作。`,
      });
    }
    if (!normalizedEvidenceRef) {
      return blocked({
        reason,
        intent,
        recommendedMode: exception.recommended_mode,
        nextAction: `${exception.next_action} 必須提供可追溯的 evidence_ref，才可建立 worktree。`,
      });
    }
    return {
      decision: "allow",
      worktree_allowed: true,
      topology_required: true,
      ...exception,
      reason,
      intent,
      evidence_ref: normalizedEvidenceRef,
    };
  }

  const nonException = NON_EXCEPTIONS[reason];
  if (nonException) {
    if (reason === "unknown_or_overlapping_dirty") {
      return blocked({
        reason,
        intent,
        recommendedMode: nonException.recommended_mode,
        nextAction: nonException.next_action,
      });
    }
    return {
      decision: "allow",
      worktree_allowed: false,
      reason,
      intent,
      ...nonException,
    };
  }

  throw new Error(`unsupported worktree exception reason: ${reason || "(missing)"}`);
}

function readOption(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] || null;
}

function main() {
  const reason = readOption("--reason");
  const intent = readOption("--intent");
  const evidenceRef = readOption("--evidence-ref");
  if (!reason || !intent) {
    process.stderr.write("Usage: node scripts/worktree-exception-preflight.mjs --reason <reason> --intent implementation|verification [--evidence-ref <reference>] [--json]\n");
    return 64;
  }

  let result;
  try {
    result = decideWorktreeMode({ reason, intent, evidenceRef });
  } catch (error) {
    process.stderr.write(`ERROR: ${error.message}\n`);
    return 64;
  }

  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`decision: ${result.decision}\nworktree_allowed: ${result.worktree_allowed}\nrecommended_mode: ${result.recommended_mode}\nnext_action: ${result.next_action}\n`);
  }
  return result.decision === "allow" ? 0 : 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main();
}
