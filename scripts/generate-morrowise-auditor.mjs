#!/usr/bin/env node
// MorroWise auditor generator v0 (morrowise/morrowise-auditor-fixtures, MW-AUDITOR-02).
// Generic engine + target profiles: scans managed markdown docs and emits a
// morrowise-auditor.v0 read model (public/data/morrowise-auditor.json).
// Read-only by contract: report / recommend / draft_task only — never edits sources.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const collabRoot = path.resolve(root, "..");
const outPath = path.join(root, "public", "data", "morrowise-auditor.json");

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

export function generateAuditorReport(options = {}) {
  const profiles = options.profiles || [ARCHITECTURE_PULSE_PROFILE];
  const now = options.now ? new Date(options.now) : new Date();
  const targets = [];
  const findings = [];

  for (const profile of profiles) {
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
