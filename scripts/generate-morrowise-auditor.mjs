#!/usr/bin/env node
// MorroWise auditor generator v0 (morrowise/morrowise-auditor-fixtures, MW-AUDITOR-02).
// Generic engine + target profiles: scans managed markdown docs and emits a
// morrowise-auditor.v0 read model (public/data/morrowise-auditor.json).
// Read-only by contract: report / recommend / draft_task only — never edits sources.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCollabRoot } from "./collab-root.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const collabRoot = resolveCollabRootOrStandalone(root);
const outPath = path.join(root, "public", "data", "morrowise-auditor.json");

function resolveCollabRootOrStandalone(start) {
  try {
    return resolveCollabRoot(start);
  } catch {
    return path.dirname(start);
  }
}

const HEADER_CONTRACT_FIELDS = ["Status", "Owner", "Read when", "Write policy", "Stale rule", "Warn after", "Error after", "Verifier"];

// First target profile: Architecture Pulse over ARCHITECTURE.md
// (checks per docs/morrowise/architecture-pulse-mvp.md, categories per auditor schema).
export const ARCHITECTURE_PULSE_PROFILE = {
  target_id: "architecture_docs.ARCHITECTURE",
  target_path: "$COLLAB/notyet-harness/000_Agent/ARCHITECTURE.md",
  source_family: "architecture_docs",
  expected_identity: "canonical",
  verifier_ref: "npm run test:morrowise-auditor-generator",
  updated_pattern: /(?:最後更新|Updated)[：:]\s*(\d{4}-\d{2}-\d{2})/,
  warn_after_days: 30,
  freshness_reference_inputs: [
    "$COLLAB/notyet-harness/000_Agent/docs/morrowise/source-map-v0.md",
    "$COLLAB/notyet-harness/000_Agent/docs/morrowise/architecture-pulse-mvp.md",
  ],
  source_of_truth_pattern: /Source of truth[：:]\s*`?([^`\n→]+)`?/,
  legacy_source_markers: ["workspace/"],
  path_policy_patterns: [/~\/(?:Downloads|Documents)\/[^\s`|)]*/g, /\/Users\/[A-Za-z][^\s`|)]*/g],
  fake_live_rules: [{ id: "schedule-tables", heading_pattern: /排程|Cron|cron/ }],
  verifier_required_rules: [
    { id: "notion-integration", heading_pattern: /Notion/ },
    { id: "mission-control-runtime", heading_pattern: /Mission Control/ },
  ],
  historical_markers: /OpenClaw|workspace\//,
  historical_split_marker: /歷史附錄|Historical appendix/,
};

// Second target profile: harness governance docs (JV-14, morrowise/auditor-harness-governance-profile).
// Directory-level profile over docs/morrowise/harness/: header contract by file class
// (amendment §2: protocol/boundary/template/patch-plan strict, handoff/evidence/research lenient),
// change-approval-plan patch-status parse, dangling $COLLAB / tombstoned-doc references,
// and stale task anchors. File class is derived from filename patterns (new files default
// to strict) — no per-file hardcoding, so the profile does not rot as docs are added.
export const HARNESS_GOVERNANCE_PROFILE = {
  kind: "harness_governance",
  target_id_prefix: "harness_governance",
  source_family: "harness_governance",
  dir: "$COLLAB/notyet-harness/000_Agent/docs/morrowise/harness",
  verifier_ref: "npm run test:morrowise-auditor-generator",
  // amendment §2 五類 → 兩級：命中 pattern 者為 evidence/handoff/research（寬鬆），其餘一律嚴格
  lenient_file_patterns: [/handoff/i, /report/i, /readback/i, /diagnosis/i, /archive-map/i, /reconcile/i, /research-design/i],
  lenient_required_fields: ["Status"],
  patch_plan_files: [/^change-approval-plan\.md$/],
  patch_status_tokens: ["done", "approved", "pending approval", "pending", "rejected", "split", "blocked", "superseded"],
  // tombstone 判定只看 header 的 Status 行，避免內文提及 supersede 造成誤判
  tombstone_status_pattern: /superseded|archived|已封存|歷史紀錄/i,
  tasks_root: "$COLLAB/harness-mc/milestones",
};

// Third target profile: memory health (JV-16, morrowise/memory-health-read-model).
// Knowledge Health Model per source-map-v0: scans memory_layer + second_brain areas
// with safe metadata only (file counts, filename dates, cross-references) and emits
// public/data/memory-health.json. Fields the scanner cannot decide stay unknown/manual
// — never fake live. Local runtime (~/.claude) is metadata-only per local_runtime_boundary.
export const MEMORY_HEALTH_PROFILE = {
  kind: "memory_health",
  target_id_prefix: "memory_health",
  verifier_ref: "npm run test:morrowise-auditor-generator",
  daily_dir: "$COLLAB/notyet-harness/000_Agent/memory/daily",
  skills_dir: "$COLLAB/notyet-harness/000_Agent/skills",
  stale_daily_after_days: 3,
  reference_window_days: 30,
  out_rel: ["public", "data", "memory-health.json"],
  areas: [
    {
      id: "memory_layer.l1",
      source_family: "memory_layer",
      knowledge_area: "L1 活躍工作區",
      path: "$COLLAB/notyet-harness/000_Agent/memory/MEMORY.md",
      reference_patterns: ["MEMORY.md", "memory/MEMORY"],
      maintenance_owner: "Vincent；任一 Agent 可提出 candidate，僅可在 Vincent 核准後更新 L1",
      known_gaps: ["completeness_state 無法由 scanner 判定（manual）"],
    },
    {
      id: "memory_layer.daily",
      source_family: "memory_layer",
      knowledge_area: "Daily memory（cc-log 交接）",
      path: "$COLLAB/notyet-harness/000_Agent/memory/daily",
      reference_patterns: ["memory/daily", "cc-log"],
      maintenance_owner: "明確受託的 Agent；daily 僅為 raw log，不自動升級 L1 或變更 task",
      known_gaps: [],
    },
    {
      id: "second_brain.obsidian_brain",
      source_family: "second_brain",
      knowledge_area: "Obsidian 第二大腦",
      path: "$COLLAB/notyet-harness/300_Obsidian_brain",
      reference_patterns: ["300_Obsidian_brain", "Obsidian"],
      maintenance_owner: "Vincent + Obsidian CLI skills",
      known_gaps: ["knowledge_health_metrics_missing（source-map SM-V0-07）：使用頻率/完善度需人工判定"],
    },
    {
      id: "second_brain.hc",
      source_family: "second_brain",
      knowledge_area: "HC 思考框架知識庫",
      path: "$COLLAB/notyet-harness/300_Obsidian_brain/HC",
      reference_patterns: ["300_Obsidian_brain/HC", "#rightProblem", "hc_refs", "HC framing"],
      maintenance_owner: "Vincent + hc-framing-gate verifier",
      known_gaps: [],
    },
    {
      id: "memory_layer.local_runtime",
      source_family: "memory_layer",
      knowledge_area: "CC 本機 memory（local runtime boundary）",
      path: "~/.claude/projects",
      local_runtime_boundary: true,
      reference_patterns: [],
      maintenance_owner: "local runtime candidate source（僅回報存在性與 metadata，不讀內容）",
      known_gaps: ["依 local_runtime_boundary 只記存在性與檔數，不讀內容"],
    },
  ],
};

export function generateAuditorReport(options = {}) {
  const profiles = options.profiles || [ARCHITECTURE_PULSE_PROFILE, HARNESS_GOVERNANCE_PROFILE, MEMORY_HEALTH_PROFILE];
  const now = options.now ? new Date(options.now) : new Date();
  const targets = [];
  const findings = [];

  for (const profile of profiles) {
    if (profile.kind === "harness_governance") {
      targets.push(...auditHarnessGovernance(profile, now, findings, options));
      continue;
    }
    if (profile.kind === "memory_health") {
      targets.push(...auditMemoryHealth(profile, now, findings, options));
      continue;
    }
    const filePath = resolveCollabPath(profile.target_path);
    const target = auditTarget(profile, filePath, now, findings);
    targets.push(target);
  }

  const summary = summarize(targets, findings, options.primaryNextAction);
  const data = {
    schema_version: "morrowise-auditor.v0",
    generated_at: now.toISOString(),
    read_only: true,
    targets,
    summary,
    findings,
    next_actions: buildNextActions(findings, options.ownerTask || "architecture-pulse-source-edit"),
    write_boundary: readOnlyBoundary(),
  };

  if (options.write !== false) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(data, null, 2)}\n`);
    console.log(`Generated ${outPath} — ${targets.length} targets, ${findings.length} findings`);
  }

  return data;
}

function auditTarget(profile, filePath, now, findings) {
  const checks = [];
  const findingIdBase = `AP-${now.toISOString().slice(0, 10).replaceAll("-", "")}`;
  let findingSeq = findings.length;
  const nextFindingId = () => `${findingIdBase}-${String(++findingSeq).padStart(2, "0")}`;
  const emit = (input) =>
    findings.push({
      id: nextFindingId(),
      target_id: profile.target_id,
      source_family: profile.source_family,
      ...input,
    });

  if (!fs.existsSync(filePath)) {
    checks.push({ id: "target-existence", kind: "source_existence", result: "missing" });
    emit({
      severity: "error",
      category: "source_missing",
      evidence_ref: profile.target_path,
      declared_state: "Target profile points to a managed source document.",
      observed_state: "The target file cannot be resolved on disk.",
      why_it_matters: "An unreadable target makes every downstream claim about it unverifiable.",
      suggested_action: "Fix the target path in the profile or restore the managed document.",
    });
    return buildTarget(profile, checks, []);
  }

  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split("\n");
  const sections = parseSections(lines);
  const headerEnd = sections.length > 0 ? sections[0].start - 1 : lines.length;
  const headerText = lines.slice(0, headerEnd).join("\n");

  // header contract
  const missingHeaderFields = HEADER_CONTRACT_FIELDS.filter((field) => !headerText.includes(field));
  if (missingHeaderFields.length > 0) {
    checks.push({ id: "header-contract", kind: "header", result: "fail" });
    emit({
      severity: "error",
      category: "missing_header",
      evidence_ref: `${profile.target_path}:1-${headerEnd}`,
      declared_state: "The document header carries a title and update metadata.",
      observed_state: `Folder-contract fields are missing: ${missingHeaderFields.join(", ")}.`,
      why_it_matters: "Without a contract, future agents cannot tell whether this file is active source, historical evidence, mirror, draft, or generated entry.",
      suggested_action: "Add a minimal folder-contract header through the explicit source-edit task; the auditor must not edit the source.",
    });
  } else {
    checks.push({ id: "header-contract", kind: "header", result: "pass" });
  }

  // source of truth hierarchy + existence
  const sourceMatch = headerText.match(profile.source_of_truth_pattern);
  if (!sourceMatch) {
    checks.push({ id: "source-of-truth", kind: "source_hierarchy", result: "missing" });
  } else {
    const declaredSource = sourceMatch[1].trim();
    const sourceLine = 1 + lines.findIndex((line) => line.includes(sourceMatch[0]));
    if (profile.legacy_source_markers.some((marker) => declaredSource.includes(marker))) {
      checks.push({ id: "source-of-truth", kind: "source_hierarchy", result: "fail" });
      emit({
        severity: "error",
        category: "missing_source_of_truth",
        evidence_ref: `${profile.target_path}:${sourceLine}`,
        declared_state: `Source of truth is declared as ${declaredSource}.`,
        observed_state: "The declared source points to a legacy location outside the current portable $COLLAB structure.",
        why_it_matters: "Future agents may follow the legacy chain and miss the current canonical source-of-truth structure.",
        suggested_action: "Rewrite the source-of-truth wording via the source-edit task to identify the managed doc and generated read models.",
      });
    } else if (!fs.existsSync(resolveCollabPath(declaredSource, path.dirname(filePath)))) {
      checks.push({ id: "source-of-truth", kind: "source_existence", result: "missing" });
      emit({
        severity: "error",
        category: "source_missing",
        evidence_ref: `${profile.target_path}:${sourceLine}`,
        declared_state: `Source of truth is declared as ${declaredSource}.`,
        observed_state: "The declared source path cannot be resolved.",
        why_it_matters: "A dangling source-of-truth reference makes the document's authority claim unverifiable.",
        suggested_action: "Point the declaration at an existing managed source via the source-edit task.",
      });
    } else {
      checks.push({ id: "source-of-truth", kind: "source_hierarchy", result: "pass" });
    }
  }

  // freshness
  const updatedMatch = content.match(profile.updated_pattern);
  if (!updatedMatch) {
    checks.push({ id: "freshness", kind: "freshness", result: "unknown" });
  } else {
    const updatedAt = new Date(updatedMatch[1]);
    const ageDays = Math.floor((now - updatedAt) / 86400000);
    const updatedLine = 1 + lines.findIndex((line) => line.includes(updatedMatch[0]));
    // The document's own declared contract wins over the profile default.
    const declaredWarn = headerText.match(/Warn after[：:]\s*(\d+)d/);
    const warnAfterDays = declaredWarn ? Number(declaredWarn[1]) : profile.warn_after_days;
    if (ageDays > warnAfterDays) {
      checks.push({ id: "freshness", kind: "freshness", result: "warning" });
      emit({
        severity: "warning",
        category: "stale_warning",
        evidence_ref: `${profile.target_path}:${updatedLine}`,
        declared_state: `Last updated ${updatedMatch[1]}.`,
        observed_state: `The document is ${ageDays} days old (warn threshold ${warnAfterDays}); newer managed inputs exist: ${profile.freshness_reference_inputs.join(", ")}.`,
        why_it_matters: "A stale architecture entry underrepresents current control-plane routing, read models, and surface boundaries.",
        suggested_action: "Keep this file as a managed target and use generated read models for current state.",
      });
    } else {
      checks.push({ id: "freshness", kind: "freshness", result: "pass" });
    }
  }

  // path policy
  const pathHits = [];
  lines.forEach((line, index) => {
    for (const pattern of profile.path_policy_patterns) {
      pattern.lastIndex = 0;
      if (pattern.test(line)) pathHits.push(index + 1);
    }
  });
  if (pathHits.length > 0) {
    checks.push({ id: "path-policy", kind: "path_policy", result: "fail" });
    emit({
      severity: "error",
      category: "path_policy_violation",
      evidence_ref: `${profile.target_path}:${pathHits[0]}-${pathHits[pathHits.length - 1]}`,
      declared_state: "Shared documentation should reference portable $COLLAB paths.",
      observed_state: `${pathHits.length} line(s) use hardcoded local home/absolute paths (first at line ${pathHits[0]}).`,
      why_it_matters: "Shared docs must not depend on a machine-local path; the other machine and future agents cannot resolve it.",
      suggested_action: "Regenerate or rewrite the affected blocks to emit $COLLAB paths with generator metadata.",
    });
  } else {
    checks.push({ id: "path-policy", kind: "path_policy", result: "pass" });
  }

  // generated boundary
  const generatedSections = sections.filter((section) => /自動產生|auto-generated/i.test(section.text));
  let generatedConflict = false;
  for (const section of generatedSections) {
    const hasGeneratorRef = /script|generator|\.py|\.mjs|\.sh/i.test(section.text);
    const hasManualEditMarker = /手動修改|hand[- ]edited|manually edited/i.test(section.text);
    if (!hasGeneratorRef || hasManualEditMarker) {
      generatedConflict = true;
      emit({
        severity: "error",
        category: "generated_manual_conflict",
        evidence_ref: `${profile.target_path}:${section.start}-${section.end}`,
        declared_state: `Section "${section.title}" is marked auto-generated.`,
        observed_state: hasManualEditMarker
          ? "The generated block carries manual-edit markers."
          : "The generated block does not reference the generator that owns it.",
        why_it_matters: "A generated block without a rerunnable generator (or with manual edits) silently becomes a second hand-written source.",
        suggested_action: "Route the block through a marker-sync generator with generated_at and verifier metadata.",
      });
    }
  }
  checks.push({ id: "generated-boundary", kind: "generated_boundary", result: generatedSections.length === 0 ? "unknown" : generatedConflict ? "fail" : "pass" });

  // fake-live surfaces
  for (const rule of profile.fake_live_rules || []) {
    const matched = sections.filter((section) => rule.heading_pattern.test(section.title));
    const risky = matched.filter((section) => /\|.*\|/.test(section.text) && !/verifier|驗證腳本|generated_at/i.test(section.text));
    if (risky.length > 0) {
      const start = Math.min(...risky.map((section) => section.start));
      const end = Math.max(...risky.map((section) => section.end));
      checks.push({ id: `live-surface-${rule.id}`, kind: "live_surface", result: "warning" });
      emit({
        severity: "warning",
        category: "fake_live_risk",
        evidence_ref: `${profile.target_path}:${start}-${end}`,
        declared_state: `Sections ${risky.map((section) => `"${section.title}"`).join(", ")} present operational tables.`,
        observed_state: "No generated read model, stale rule, or verifier is attached to these tables.",
        why_it_matters: "A static operational table can look authoritative while actual runtime state has drifted.",
        suggested_action: "Represent the runtime via generated read models and downgrade static tables to historical/routing evidence.",
      });
    } else if (matched.length > 0) {
      checks.push({ id: `live-surface-${rule.id}`, kind: "live_surface", result: "pass" });
    }
  }

  // verifier presence
  for (const rule of profile.verifier_required_rules || []) {
    const matched = sections.filter((section) => rule.heading_pattern.test(section.title));
    if (matched.length === 0) continue;
    const missing = matched.filter((section) => !/verifier|驗證腳本|capability registry|safe probe/i.test(section.text));
    if (missing.length > 0) {
      const start = Math.min(...missing.map((section) => section.start));
      const end = Math.max(...missing.map((section) => section.end));
      checks.push({ id: `verifier-presence-${rule.id}`, kind: "reference", result: "warning" });
      emit({
        severity: "warning",
        category: "missing_verifier",
        evidence_ref: `${profile.target_path}:${start}-${end}`,
        declared_state: `Sections ${missing.map((section) => `"${section.title}"`).join(", ")} declare live integrations or runtime state.`,
        observed_state: "No verifier, capability registry link, or safe-probe policy is referenced.",
        why_it_matters: "Declared integrations without verifiers cannot be trusted as current state and may expose write authority ambiguity.",
        suggested_action: "Keep the section as routing evidence and let capability registry / read models define current authority.",
      });
    } else {
      checks.push({ id: `verifier-presence-${rule.id}`, kind: "reference", result: "pass" });
    }
  }

  // historical vs active mix
  const classified = sections.map((section) => classifySection(section, profile));
  if (profile.historical_markers) {
    const hasHistorical = classified.some((section) => section.classification === "historical" || section.classification === "mixed");
    const hasSplit = profile.historical_split_marker.test(content);
    if (hasHistorical && !hasSplit) {
      const evidenceSections = classified.filter((section) => section.classification !== "active" && section.classification !== "unknown");
      checks.push({ id: "section-identity", kind: "reference", result: "warning" });
      emit({
        severity: "info",
        category: "historical_used_as_active",
        evidence_ref: `${profile.target_path}:${evidenceSections[0]?.start || 1}-${evidenceSections[evidenceSections.length - 1]?.end || lines.length}`,
        declared_state: "The document presents historical and current system descriptions side by side.",
        observed_state: "Historical material is present without an explicit active/historical split.",
        why_it_matters: "Future agents need to know whether to operate current loops or only extract patterns from historical material.",
        suggested_action: "Split active entry from historical appendix in the source-edit task.",
      });
    } else {
      checks.push({ id: "section-identity", kind: "reference", result: hasHistorical ? "pass" : "unknown" });
    }
  }

  return buildTarget(
    profile,
    checks,
    classified.map((section) => ({
      id: slugify(section.title),
      line_ref: `${profile.target_path}:${section.start}-${section.end}`,
      classification: section.classification,
      reason: section.reason,
    })),
  );
}

function auditHarnessGovernance(profile, now, findings, options = {}) {
  const dirPath = resolveCollabPath(profile.dir);
  const findingIdBase = `HG-${now.toISOString().slice(0, 10).replaceAll("-", "")}`;
  let findingSeq = 0;
  const emit = (targetId, input) =>
    findings.push({
      id: `${findingIdBase}-${String(++findingSeq).padStart(2, "0")}`,
      target_id: targetId,
      source_family: profile.source_family,
      ...input,
    });

  if (!fs.existsSync(dirPath)) {
    const targetId = `${profile.target_id_prefix}.dir`;
    emit(targetId, {
      severity: "error",
      category: "source_missing",
      evidence_ref: profile.dir,
      declared_state: "The harness governance profile points at a managed docs directory.",
      observed_state: "The directory cannot be resolved on disk.",
      why_it_matters: "Every governance claim downstream of this profile becomes unverifiable.",
      suggested_action: "Fix the profile dir or restore the harness docs directory.",
    });
    return [
      {
        target_id: targetId,
        target_path: profile.dir,
        source_family: profile.source_family,
        expected_identity: "protocol",
        classification: "unknown",
        checks: [{ id: "target-existence", kind: "source_existence", result: "missing" }],
        sections: [],
        verifier_ref: profile.verifier_ref,
        write_boundary: readOnlyBoundary(),
      },
    ];
  }

  const fileNames = fs
    .readdirSync(dirPath)
    .filter((name) => name.endsWith(".md"))
    .sort();

  // Pre-scan: tombstone map（header Status 行判定），供殘引用檢查
  const tombstoned = new Set();
  const docs = new Map();
  for (const name of fileNames) {
    const content = fs.readFileSync(path.join(dirPath, name), "utf8");
    const lines = content.split("\n");
    const headerEnd = lines.findIndex((line) => /^##\s+/.test(line));
    const headerLines = lines.slice(0, headerEnd === -1 ? lines.length : headerEnd);
    const statusLine = headerLines.find((line) => /^>?\s*(?:\*\*)?Status(?:\*\*)?[：:]/.test(line)) || "";
    if (profile.tombstone_status_pattern.test(statusLine)) tombstoned.add(name);
    docs.set(name, { content, lines, headerText: headerLines.join("\n"), statusLine });
  }

  const tasksCache = new Map();
  const tasksRoot = resolveCollabPath(profile.tasks_root);
  const targets = [];
  const fileEntries = [];
  let patchPlanSummary = null;

  for (const name of fileNames) {
    const { content, lines, headerText, statusLine } = docs.get(name);
    const findingsBefore = findings.length;
    const targetId = `${profile.target_id_prefix}.${slugify(name.replace(/\.md$/, ""))}`;
    const targetPath = `${profile.dir}/${name}`;
    const lenient = profile.lenient_file_patterns.some((pattern) => pattern.test(name));
    const isTombstoned = tombstoned.has(name);
    const checks = [];

    // 1. header contract by class（amendment §2 分級；缺 header → degraded/unknown；墓碑檔只需 lenient 欄位）
    const requiredFields = lenient || isTombstoned ? profile.lenient_required_fields : HEADER_CONTRACT_FIELDS;
    const missingFields = requiredFields.filter((field) => !headerText.includes(field));
    if (missingFields.length > 0) {
      checks.push({ id: "header-contract", kind: "header", result: "fail" });
      emit(targetId, {
        severity: "error",
        category: "missing_header",
        evidence_ref: `${targetPath}:1`,
        declared_state: `Harness ${lenient ? "evidence/handoff" : "protocol-class"} doc carries a ${lenient ? "minimal Status" : "full folder-contract"} header.`,
        observed_state: `Missing header field(s): ${missingFields.join(", ")}.`,
        why_it_matters: "Without the class-appropriate header contract, future agents cannot tell rule-bearing protocol from historical evidence.",
        suggested_action: "Add the missing header fields via a task-backed source edit; the auditor stays read-only.",
      });
    } else {
      checks.push({ id: "header-contract", kind: "header", result: "pass" });
    }

    // 2. patch plan 狀態欄 parse（僅 patch-plan 檔；格式由 fixture 鎖定）
    if (profile.patch_plan_files.some((pattern) => pattern.test(name))) {
      const patchSections = parseSections(lines).filter((section) => /^P\d+｜/.test(section.title));
      const broken = [];
      const byStatus = {};
      for (const section of patchSections) {
        const statusMatch = section.text.match(/^-\s*\*\*狀態\*\*[：:]\s*(.+)$/m);
        const token = statusMatch ? statusMatch[1].trim() : null;
        const matched = token ? profile.patch_status_tokens.find((allowed) => token.toLowerCase().startsWith(allowed)) : null;
        if (matched) byStatus[matched] = (byStatus[matched] || 0) + 1;
        const recognized = Boolean(matched);
        if (!recognized) broken.push({ title: section.title, start: section.start, token });
      }
      patchPlanSummary = { file: name, total: patchSections.length, by_status: byStatus, unparsed: broken.length };
      if (patchSections.length === 0 || broken.length > 0) {
        checks.push({ id: "patch-plan-status", kind: "live_surface", result: "fail" });
        emit(targetId, {
          severity: "error",
          category: "fake_live_risk",
          evidence_ref: `${targetPath}:${broken[0]?.start || 1}`,
          declared_state: "Every patch section (## Pn｜) carries a parseable `- **狀態**：<token>` line updated by the executing session.",
          observed_state:
            patchSections.length === 0
              ? "No patch sections were found to parse."
              : broken.map((entry) => `"${entry.title}" → ${entry.token ? `unrecognized token "${entry.token}"` : "no 狀態 line"}`).join("; "),
          why_it_matters: "An unparseable patch status column can present executed patches as pending (or the reverse) to future sessions.",
          suggested_action: "Restore the locked `- **狀態**：<token>` format via the owning patch-plan session.",
        });
      } else {
        checks.push({ id: "patch-plan-status", kind: "live_surface", result: "pass" });
      }
    }

    // 3+4. 殘引用（僅嚴格類檔）：dangling $COLLAB 路徑、tombstoned harness 檔被引用、stale task anchor
    if (!lenient && !isTombstoned) {
      const refs = collectCollabRefs(content);
      const dangling = refs.filter((ref) => {
        const resolved = resolveCollabPath(ref.path);
        if (fs.existsSync(resolved)) return false;
        // 含空格檔名會被 regex 截斷成前綴；目錄內存在同前綴檔案時視為不可驗證而非 dangling
        const dir = path.dirname(resolved);
        const base = path.basename(resolved);
        return !(fs.existsSync(dir) && fs.readdirSync(dir).some((entry) => entry.startsWith(base)));
      });
      if (dangling.length > 0) {
        checks.push({ id: "collab-refs", kind: "source_existence", result: "fail" });
        emit(targetId, {
          severity: "error",
          category: "source_missing",
          evidence_ref: `${targetPath}:${dangling[0].line}`,
          declared_state: "Protocol-class docs reference resolvable $COLLAB paths.",
          observed_state: `${dangling.length} dangling reference(s), first: ${dangling
            .slice(0, 5)
            .map((ref) => ref.path)
            .join(", ")}.`,
          why_it_matters: "Dangling references after supersede/archive rounds send future agents to sources that no longer exist.",
          suggested_action: "Repoint or remove the residual references via the supersede-lifecycle residual-cleanup step.",
        });
      } else {
        checks.push({ id: "collab-refs", kind: "source_existence", result: "pass" });
      }

      const tombstonedRefs = [...tombstoned].filter((other) => other !== name && content.includes(other));
      if (tombstonedRefs.length > 0) {
        checks.push({ id: "tombstoned-refs", kind: "reference", result: "warning" });
        emit(targetId, {
          severity: "warning",
          category: "historical_used_as_active",
          evidence_ref: `${targetPath}:1`,
          declared_state: "Protocol-class docs reference living documents.",
          observed_state: `References tombstoned/superseded doc(s): ${tombstonedRefs.join(", ")}.`,
          why_it_matters: "A protocol pointing at a superseded doc re-opens the second-source-of-truth drift the supersede protocol closed.",
          suggested_action: "Repoint the reference to the superseding doc or mark the mention as historical context.",
        });
      } else {
        checks.push({ id: "tombstoned-refs", kind: "reference", result: "pass" });
      }

      const anchorPattern = /milestones\/([a-z0-9-]+)\/tasks\.json#([A-Za-z0-9_-]+)/g;
      const staleAnchors = [];
      let anchorCount = 0;
      for (const match of content.matchAll(anchorPattern)) {
        anchorCount += 1;
        const [, project, taskId] = match;
        if (!tasksCache.has(project)) {
          const tasksPath = path.join(tasksRoot, project, "tasks.json");
          tasksCache.set(
            project,
            fs.existsSync(tasksPath) ? new Set(JSON.parse(fs.readFileSync(tasksPath, "utf8")).tasks.map((task) => task.id)) : null,
          );
        }
        const ids = tasksCache.get(project);
        if (!ids || !ids.has(taskId)) staleAnchors.push(`${project}#${taskId}`);
      }
      if (staleAnchors.length > 0) {
        checks.push({ id: "task-anchors", kind: "reference", result: "fail" });
        emit(targetId, {
          severity: "error",
          category: "source_missing",
          evidence_ref: `${targetPath}:1`,
          declared_state: "Task anchors in governance docs point at existing canonical tasks.",
          observed_state: `Stale task anchor(s): ${staleAnchors.slice(0, 5).join(", ")}.`,
          why_it_matters: "Stale task ids in governance docs are the same self-rot failure mode as verifiers hard-coding live task ids.",
          suggested_action: "Repoint the anchor at the current task id via a task-backed source edit.",
        });
      } else {
        checks.push({ id: "task-anchors", kind: "reference", result: anchorCount > 0 ? "pass" : "unknown" });
      }
    }

    targets.push({
      target_id: targetId,
      target_path: targetPath,
      source_family: profile.source_family,
      expected_identity: isTombstoned ? "historical" : lenient ? "evidence" : "protocol",
      classification: isTombstoned ? "historical" : missingFields.length > 0 ? "unknown" : "active",
      checks,
      sections: [],
      verifier_ref: profile.verifier_ref,
      write_boundary: readOnlyBoundary(),
    });

    const fileFindings = findings.slice(findingsBefore);
    fileEntries.push({
      name,
      class: isTombstoned ? "historical" : lenient ? "evidence" : "protocol",
      header_status: classifyHeaderStatus(statusLine, isTombstoned),
      header_status_excerpt: statusLine.replace(/^>?\s*(?:\*\*)?Status(?:\*\*)?[：:]\s*/, "").slice(0, 120) || null,
      finding_count: fileFindings.length,
      finding_categories: [...new Set(fileFindings.map((finding) => finding.category))],
    });
  }

  // JV-15：harness governance read model（#discipline 狀態卡資料源；auditor 即 scanner，不開第二套）
  const brokenFiles = fileEntries.filter((entry) => entry.finding_categories.some((category) => category !== "stale_warning"));
  const staleFiles = fileEntries.filter((entry) => entry.finding_categories.includes("stale_warning"));
  const statusCounts = {};
  for (const entry of fileEntries) statusCounts[entry.header_status] = (statusCounts[entry.header_status] || 0) + 1;
  const governanceModel = {
    schema_version: "harness-governance.v0",
    generated_at: now.toISOString(),
    read_only: true,
    source: "$COLLAB/harness-mc/system-workflow/registries/morrowise-harness-governance.json",
    generator: "$COLLAB/harness-mc/scripts/generate-morrowise-auditor.mjs",
    output: "$COLLAB/harness-mc/public/data/harness-governance.json",
    docs_dir: profile.dir,
    stale_rule: "Regenerate with the auditor run (prebuild / system-pulse); stale when harness docs change without a rerun.",
    counts: {
      total: fileEntries.length,
      by_header_status: statusCounts,
      broken: brokenFiles.length,
      stale: staleFiles.length,
    },
    patch_plan: patchPlanSummary,
    failing_files: brokenFiles.map((entry) => ({ name: entry.name, categories: entry.finding_categories })),
    files: fileEntries,
    next_actions: [
      {
        id: "HG-NA-01",
        priority: 1,
        action:
          brokenFiles.length > 0
            ? `修復 ${brokenFiles.length} 個 governance findings 檔案（走 task-backed source edit）`
            : "無 governance findings；accepted 標記仍由 Vincent 裁決（本卡只顯示不裁決）。",
        owner_task: "auditor-harness-governance-profile",
        status: brokenFiles.length > 0 ? "ready" : "draft",
      },
    ],
    write_boundary: readOnlyBoundary(),
    verifier_ref: "npm run test:morrowise-auditor-generator",
  };

  if (options.write !== false) {
    const outFile = path.join(root, "public", "data", "harness-governance.json");
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, `${JSON.stringify(governanceModel, null, 2)}\n`);
    console.log(`Generated ${outFile} — ${fileEntries.length} harness docs, ${brokenFiles.length} broken`);
  }
  if (options.harnessGovernanceSink) options.harnessGovernanceSink.push(governanceModel);

  return targets;
}

// header Status 行 → 狀態分級（accepted 只能由 Vincent 標——這裡只讀不判）
function classifyHeaderStatus(statusLine, isTombstoned) {
  if (isTombstoned) return "historical";
  const text = statusLine.toLowerCase();
  if (!text) return "unknown";
  if (text.includes("accepted")) return "accepted";
  if (text.includes("final")) return "final";
  if (text.includes("draft")) return "draft";
  return "other";
}

function auditMemoryHealth(profile, now, findings, options = {}) {
  const findingIdBase = `MH-${now.toISOString().slice(0, 10).replaceAll("-", "")}`;
  let findingSeq = 0;
  const emit = (targetId, input) =>
    findings.push({
      id: `${findingIdBase}-${String(++findingSeq).padStart(2, "0")}`,
      target_id: targetId,
      source_family: input.source_family,
      ...input,
    });

  // 近 30 天 daily log 內容當引用證據源（安全 metadata：只數命中，不外流內文）
  const dailyDir = resolveCollabPath(profile.daily_dir);
  const windowStart = new Date(now.getTime() - profile.reference_window_days * 86400000);
  const recentDailyTexts = [];
  let latestDailyDate = null;
  if (fs.existsSync(dailyDir)) {
    for (const name of fs.readdirSync(dailyDir).sort()) {
      const dateMatch = name.match(/^(\d{4}-\d{2}-\d{2})\.md$/);
      if (!dateMatch) continue;
      const fileDate = new Date(`${dateMatch[1]}T00:00:00Z`);
      if (fileDate > now) continue; // 未來日期檔不當現在證據
      if (!latestDailyDate || fileDate > latestDailyDate) latestDailyDate = fileDate;
      if (fileDate >= windowStart) {
        recentDailyTexts.push({ date: dateMatch[1], text: fs.readFileSync(path.join(dailyDir, name), "utf8") });
      }
    }
  }

  // workflow link 掃描：skills 目錄哪些 SKILL.md 引用了該 area
  const skillsDir = resolveCollabPath(profile.skills_dir);
  const skillDocs = [];
  if (fs.existsSync(skillsDir)) {
    for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillPath = path.join(skillsDir, entry.name, "SKILL.md");
      if (fs.existsSync(skillPath)) skillDocs.push({ skill: entry.name, text: fs.readFileSync(skillPath, "utf8") });
    }
  }

  const areasOut = [];
  const targets = [];

  for (const area of profile.areas) {
    const targetId = `${profile.target_id_prefix}.${slugify(area.id)}`;
    const areaPath = area.path.startsWith("~/") ? path.join(process.env.HOME || "", area.path.slice(2)) : resolveCollabPath(area.path);
    const exists = fs.existsSync(areaPath);
    const checks = [{ id: "area-existence", kind: "source_existence", result: exists ? "pass" : "missing" }];
    const isDir = exists && fs.statSync(areaPath).isDirectory();
    const fileCount = exists ? (isDir ? countFilesShallow(areaPath) : 1) : 0;

    if (!exists && !area.local_runtime_boundary) {
      emit(targetId, {
        severity: "error",
        category: "source_missing",
        source_family: area.source_family,
        evidence_ref: area.path.startsWith("~/") ? `manual:${area.path}` : area.path,
        declared_state: `Knowledge area "${area.knowledge_area}" has a resolvable source path.`,
        observed_state: "The area path cannot be resolved on disk.",
        why_it_matters: "A missing knowledge area makes every health metric about it unverifiable.",
        suggested_action: "Fix the area path in the profile or restore the source.",
      });
    }

    // 引用次數（inferred）：近 30 天 daily 內容命中 reference_patterns 的天數與次數
    let referenceCount = 0;
    let lastUsedAt = null;
    if (!area.local_runtime_boundary && exists) {
      for (const daily of recentDailyTexts) {
        const hits = area.reference_patterns.reduce((acc, pattern) => acc + (daily.text.includes(pattern) ? 1 : 0), 0);
        if (hits > 0) {
          referenceCount += hits;
          if (!lastUsedAt || daily.date > lastUsedAt) lastUsedAt = daily.date;
        }
      }
    }

    const workflowLinks = area.local_runtime_boundary
      ? []
      : skillDocs
          .filter((doc) => area.reference_patterns.some((pattern) => doc.text.includes(pattern)))
          .map((doc) => `skill:${doc.skill}`);

    // daily area 專屬 stale 檢查：最新檔名日期距 now 超過門檻 → stale_warning
    if (area.id === "memory_layer.daily" && exists && latestDailyDate) {
      const ageDays = Math.floor((now - latestDailyDate) / 86400000);
      if (ageDays > profile.stale_daily_after_days) {
        checks.push({ id: "daily-freshness", kind: "freshness", result: "warning" });
        emit(targetId, {
          severity: "warning",
          category: "stale_warning",
          source_family: area.source_family,
          evidence_ref: `${area.path}/${latestDailyDate.toISOString().slice(0, 10)}.md`,
          declared_state: "Daily memory receives agent-neutral raw-log blocks on explicitly requested active work days; it does not auto-promote to L1 or mutate tasks.",
          observed_state: `Latest daily file is ${ageDays} days old (threshold ${profile.stale_daily_after_days}).`,
          why_it_matters: "A silent daily log means session handoffs are accumulating only in chat context and will be lost.",
          suggested_action: "Run cc-log at session end or verify the daily write cron.",
        });
      } else {
        checks.push({ id: "daily-freshness", kind: "freshness", result: "pass" });
      }
    }

    // missing workflow link：知識區沒有任何 skill/workflow 接線（local runtime 除外）
    if (!area.local_runtime_boundary && exists && workflowLinks.length === 0) {
      checks.push({ id: "workflow-links", kind: "reference", result: "warning" });
    } else if (!area.local_runtime_boundary && exists) {
      checks.push({ id: "workflow-links", kind: "reference", result: "pass" });
    }

    const knownGaps = [...area.known_gaps];
    if (!area.local_runtime_boundary && exists && workflowLinks.length === 0) {
      knownGaps.push("missing workflow_link：無任何 skill 引用此知識區，取用只能靠人記");
    }

    // 不得假 live：completeness 無法判定 → unknown；缺核心指標時 freshness 只能 unknown/manual
    const completenessState = "unknown";
    const freshnessState = area.local_runtime_boundary ? "manual" : lastUsedAt ? "fresh" : "unknown";

    areasOut.push({
      id: area.id,
      knowledge_area: area.knowledge_area,
      source_family: area.source_family,
      source_files: [area.path],
      exists,
      file_count: fileCount,
      last_used_at: lastUsedAt,
      reference_count_30d: area.local_runtime_boundary ? "unknown" : referenceCount,
      completeness_state: completenessState,
      workflow_links: workflowLinks,
      known_gaps: knownGaps,
      maintenance_owner: area.maintenance_owner,
      confidence: {
        last_used_at: lastUsedAt ? "inferred" : "manual",
        reference_count_30d: area.local_runtime_boundary ? "manual" : "inferred",
        completeness_state: "manual",
        workflow_links: "inferred",
      },
      freshness_state: freshnessState,
      local_runtime_boundary: Boolean(area.local_runtime_boundary),
    });

    // local runtime area 只進 read model（metadata-only），不進 auditor targets（無合法 $COLLAB path）
    if (!area.local_runtime_boundary) {
      targets.push({
        target_id: targetId,
        target_path: area.path,
        source_family: area.source_family,
        expected_identity: "canonical",
        classification: exists ? "semi_live" : "unknown",
        checks,
        sections: [],
        verifier_ref: profile.verifier_ref,
        write_boundary: readOnlyBoundary(),
      });
    }
  }

  // Knowledge health read model（欄位齊 MC-LIVE-SYS-01 envelope）
  const readModel = {
    schema_version: "memory-health.v0",
    generated_at: now.toISOString(),
    read_only: true,
    source_of_truth: "$COLLAB/notyet-harness/000_Agent/memory/ + $COLLAB/notyet-harness/300_Obsidian_brain/",
    source_files: [profile.daily_dir, profile.skills_dir, ...profile.areas.map((area) => area.path)],
    generator: "$COLLAB/harness-mc/scripts/generate-morrowise-auditor.mjs (MEMORY_HEALTH_PROFILE)",
    output: "$COLLAB/harness-mc/public/data/memory-health.json",
    stale_rule: `Regenerate with the auditor run; daily area warns when the newest daily file is older than ${profile.stale_daily_after_days} days.`,
    freshness_state: areasOut.some((area) => area.freshness_state === "unknown") ? "unknown" : "fresh",
    classification: "semi_live",
    areas: areasOut,
    next_action: {
      type: "task",
      target: "memory-health-read-model",
      label: "Fields the scanner cannot decide stay unknown/manual; upgrading them requires the owning workflow, not this generator.",
    },
    write_boundary: {
      allowed: ["read safe metadata", "count filename-dated files", "count cross-references", "write generated memory-health read model"],
      forbidden: ["read ~/.claude memory contents", "read secrets or runtime auth files", "edit memory sources", "modify task state"],
    },
    verifier_ref: profile.verifier_ref,
  };

  if (options.write !== false) {
    const outFile = path.join(root, ...profile.out_rel);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, `${JSON.stringify(readModel, null, 2)}\n`);
    console.log(`Generated ${outFile} — ${areasOut.length} knowledge areas`);
  }
  if (options.memoryHealthSink) options.memoryHealthSink.push(readModel);

  return targets;
}

function countFilesShallow(dirPath) {
  let count = 0;
  const stack = [dirPath];
  while (stack.length > 0 && count < 5000) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      if (entry.isDirectory()) stack.push(path.join(current, entry.name));
      else count += 1;
    }
  }
  return count;
}

// $COLLAB 參照收集：跳過含 placeholder/glob 的參照，去掉行內尾標點與 #anchor
function collectCollabRefs(content) {
  const refs = [];
  const pattern = /\$COLLAB\/[^\s`"'()\[\]{}|]+/g;
  content.split("\n").forEach((line, index) => {
    for (const match of line.matchAll(pattern)) {
      const ref = match[0].replace(/[),.。；;、」》]+$/, "").split("#")[0];
      if (/[<>*…]/.test(ref)) continue; // placeholder / glob，不是可驗證路徑
      if (ref.slice(1).includes("$")) continue; // $COLLAB 之外還有 $ → shell/template 變數
      refs.push({ path: ref, line: index + 1 });
    }
  });
  return refs;
}

function classifySection(section, profile) {
  const generated = /自動產生|auto-generated/i.test(section.text);
  const historical = profile.historical_markers ? profile.historical_markers.test(section.text) : false;
  let classification = "unknown";
  let reason = "No source, verifier, or stale rule allows a confident identity call.";
  if (generated) {
    classification = "generated";
    reason = "Marked as auto-generated content.";
  } else if (historical && /verifier|read model|\$COLLAB/i.test(section.text)) {
    classification = "mixed";
    reason = "Historical markers and current references are mixed in the same section.";
  } else if (historical) {
    classification = "historical";
    reason = "References legacy systems or paths that are no longer the active entry.";
  } else if (/\$COLLAB|tasks\.json|read model/i.test(section.text)) {
    classification = "active";
    reason = "References current portable sources.";
  }
  return { ...section, classification, reason };
}

function parseSections(lines) {
  const sections = [];
  lines.forEach((line, index) => {
    if (/^##\s+/.test(line) && !/^###/.test(line)) {
      sections.push({ title: line.replace(/^##\s+/, "").trim(), start: index + 1 });
    }
  });
  sections.forEach((section, index) => {
    section.end = index + 1 < sections.length ? sections[index + 1].start - 1 : lines.length;
    section.text = lines.slice(section.start - 1, section.end).join("\n");
  });
  return sections;
}

function buildTarget(profile, checks, sections) {
  return {
    target_id: profile.target_id,
    target_path: profile.target_path,
    source_family: profile.source_family,
    expected_identity: profile.expected_identity,
    classification: "semi_live",
    checks,
    sections,
    verifier_ref: profile.verifier_ref,
    write_boundary: readOnlyBoundary(),
  };
}

function summarize(targets, findings, primaryNextAction) {
  return {
    target_count: targets.length,
    finding_count: findings.length,
    blocking_count: findings.filter((finding) => finding.severity === "blocking").length,
    error_count: findings.filter((finding) => finding.severity === "error").length,
    warning_count: findings.filter((finding) => finding.severity === "warning").length,
    missing_verifier_count: findings.filter((finding) => finding.category === "missing_verifier").length,
    stale_count: findings.filter((finding) => finding.category.startsWith("stale_")).length,
    fake_live_risk_count: findings.filter((finding) => finding.category === "fake_live_risk").length,
    path_policy_risk_count: findings.filter((finding) => finding.category === "path_policy_violation").length,
    primary_next_action: primaryNextAction || "morrowise/architecture-pulse-source-edit",
  };
}

function buildNextActions(findings, ownerTask) {
  if (findings.length === 0) return [];
  return [
    {
      id: "NA-01",
      priority: 1,
      action: "Route target fixes through the task-backed source-edit flow; the auditor stays read-only.",
      owner_task: ownerTask,
      source_finding_ids: findings.map((finding) => finding.id),
      status: "ready",
    },
  ];
}

function readOnlyBoundary() {
  return {
    allowed: ["report", "recommend", "draft_task"],
    forbidden: ["edit_source", "close_task", "commit", "push", "external_sync"],
  };
}

function slugify(title) {
  const cleaned = title
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "section";
}

function resolveCollabPath(value, baseDir) {
  if (value.startsWith("$COLLAB/")) return path.join(collabRoot, value.slice("$COLLAB/".length));
  if (path.isAbsolute(value)) return value;
  return path.resolve(baseDir || root, value);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  generateAuditorReport();
}
