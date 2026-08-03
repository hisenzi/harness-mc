import fs from "node:fs";
import path from "node:path";

const GROUP_SCHEMA = "morrowise.milestone-group.v1";
const GROUP_MARKER_KEYS = ["id", "layout", "max_project_depth", "name", "schema_version"];
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const GROUPED_FOLDER_PATTERN = /^(\d{6})-([a-z0-9]+(?:-[a-z0-9]+)*)$/;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^﻿/, ""));
}

function assertSlug(value, label) {
  if (!SLUG_PATTERN.test(String(value || ""))) {
    throw new Error(`${label} must be a lowercase slug`);
  }
}

function assertYymmdd(value) {
  const input = String(value || "");
  if (!/^\d{6}$/.test(input)) throw new Error("folder date must be valid yymmdd");
  const year = 2000 + Number(input.slice(0, 2));
  const month = Number(input.slice(2, 4));
  const day = Number(input.slice(4, 6));
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new Error("folder date must be valid yymmdd");
  }
}

function readGroupMarker(milestonesDir, group) {
  assertSlug(group, "group");
  const markerPath = path.join(milestonesDir, group, "group.json");
  if (!fs.existsSync(markerPath)) throw new Error(`unknown milestone group: ${group}`);
  const marker = readJson(markerPath);
  const markerKeys = Object.keys(marker).sort();
  if (markerKeys.length !== GROUP_MARKER_KEYS.length
    || markerKeys.some((key, index) => key !== GROUP_MARKER_KEYS[index])) {
    throw new Error(`invalid milestone group marker schema: ${group}`);
  }
  if (marker.schema_version !== GROUP_SCHEMA || marker.id !== group) {
    throw new Error(`invalid milestone group marker: ${group}`);
  }
  if (typeof marker.name !== "string" || marker.name.trim() === "") {
    throw new Error(`invalid milestone group marker name: ${group}`);
  }
  if (marker.layout !== "grouped-yymmdd-project-v1" || marker.max_project_depth !== 1) {
    throw new Error(`unsupported milestone group layout: ${group}`);
  }
  return marker;
}

function containsTasksBelow(directory) {
  if (!fs.existsSync(directory)) return false;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isFile() && entry.name === "tasks.json") return true;
    if (entry.isDirectory() && containsTasksBelow(absolute)) return true;
  }
  return false;
}

function makeDescriptor(repoRoot, relativeDir, projectId, layout, group = null, folderDate = null) {
  const absoluteDir = path.join(repoRoot, ...relativeDir.split("/"));
  return {
    projectId,
    layout,
    group,
    folderDate,
    relativeDir,
    absoluteDir,
    projectPath: path.join(absoluteDir, "project.json"),
    tasksPath: path.join(absoluteDir, "tasks.json"),
    statePath: path.join(absoluteDir, "state.json"),
  };
}

function validateGroupedMetadata(descriptor) {
  if (!fs.existsSync(descriptor.projectPath)) {
    throw new Error(`grouped milestone missing project.json: ${descriptor.relativeDir}`);
  }
  const meta = readJson(descriptor.projectPath);
  const expected = {
    layout: "grouped-v1",
    project_id: descriptor.projectId,
    group: descriptor.group,
    folder_date: descriptor.folderDate,
    relative_ref: descriptor.relativeDir,
  };
  for (const [field, value] of Object.entries(expected)) {
    if (meta?.milestone?.[field] !== value) {
      throw new Error(`grouped milestone metadata mismatch: ${descriptor.relativeDir} field=${field}`);
    }
  }
}

export function discoverMilestoneProjects({ repoRoot, strict = true } = {}) {
  if (!repoRoot) throw new Error("repoRoot is required");
  const milestonesDir = path.join(repoRoot, "milestones");
  if (!fs.existsSync(milestonesDir)) return [];
  const descriptors = [];

  for (const entry of fs.readdirSync(milestonesDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const topDir = path.join(milestonesDir, entry.name);
    const flatTasksPath = path.join(topDir, "tasks.json");
    if (fs.existsSync(flatTasksPath)) {
      descriptors.push(makeDescriptor(repoRoot, `milestones/${entry.name}`, entry.name, "flat-v1"));
      continue;
    }

    const markerPath = path.join(topDir, "group.json");
    if (!fs.existsSync(markerPath)) {
      if (strict && containsTasksBelow(topDir)) throw new Error(`unknown milestone group: ${entry.name}`);
      continue;
    }
    readGroupMarker(milestonesDir, entry.name);

    for (const child of fs.readdirSync(topDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!child.isDirectory()) continue;
      const childDir = path.join(topDir, child.name);
      const tasksPath = path.join(childDir, "tasks.json");
      if (!fs.existsSync(tasksPath)) {
        if (strict && containsTasksBelow(childDir)) throw new Error(`grouped milestone depth exceeds one: ${entry.name}/${child.name}`);
        continue;
      }
      const match = GROUPED_FOLDER_PATTERN.exec(child.name);
      if (!match) throw new Error(`invalid grouped milestone folder: ${entry.name}/${child.name}`);
      const [, folderDate, projectId] = match;
      assertYymmdd(folderDate);
      const descriptor = makeDescriptor(
        repoRoot,
        `milestones/${entry.name}/${child.name}`,
        projectId,
        "grouped-v1",
        entry.name,
        folderDate,
      );
      if (strict) validateGroupedMetadata(descriptor);
      descriptors.push(descriptor);
    }
  }

  const byId = new Map();
  for (const descriptor of descriptors) {
    if (byId.has(descriptor.projectId)) {
      throw new Error(`duplicate milestone project ID: ${descriptor.projectId}`);
    }
    byId.set(descriptor.projectId, descriptor);
  }
  return descriptors.sort((a, b) => a.projectId.localeCompare(b.projectId));
}

export function resolveMilestoneProject({ repoRoot, projectId, strict = true } = {}) {
  return discoverMilestoneProjects({ repoRoot, strict }).find((item) => item.projectId === projectId) || null;
}

export function validateMilestoneCandidate({ repoRoot, projectId, group = null, folderDate = null } = {}) {
  assertSlug(projectId, "project ID");
  if ((group && !folderDate) || (!group && folderDate)) {
    throw new Error("group and folder date must be provided together");
  }
  if (group) {
    const milestonesDir = path.join(repoRoot, "milestones");
    readGroupMarker(milestonesDir, group);
    assertYymmdd(folderDate);
  }
  const duplicate = resolveMilestoneProject({ repoRoot, projectId });
  if (duplicate) throw new Error(`duplicate milestone project ID: ${projectId}`);
  const relativeDir = group
    ? `milestones/${group}/${folderDate}-${projectId}`
    : `milestones/${projectId}`;
  return {
    projectId,
    layout: group ? "grouped-v1" : "flat-v1",
    group: group || null,
    folderDate: folderDate || null,
    relativeDir,
  };
}

export function publicMilestoneDescriptor(descriptor) {
  return {
    projectId: descriptor.projectId,
    layout: descriptor.layout,
    group: descriptor.group,
    folderDate: descriptor.folderDate,
    relativeDir: descriptor.relativeDir,
  };
}
