import assert from "node:assert/strict";
import test from "node:test";

import * as projectFilters from "./projectFilters.mjs";

test("all filter includes projects whose tasks are all complete", () => {
  const projects = [
    { project: "active-project", domain: "臨時", done: 1, total: 2 },
    { project: "completed-project", domain: "臨時", done: 2, total: 2 },
  ];

  assert.deepEqual(
    projectFilters.getDisplayedProjects(projects, "all").map((project) => project.project),
    ["active-project", "completed-project"],
  );
});

test("domain filters include completed projects in that domain", () => {
  const projects = [
    { project: "active-project", domain: "臨時", done: 1, total: 2 },
    { project: "completed-project", domain: "臨時", done: 2, total: 2 },
    { project: "other-domain", domain: "學習", done: 1, total: 1 },
  ];

  assert.deepEqual(
    projectFilters.getDisplayedProjects(projects, "臨時").map((project) => project.project),
    ["active-project", "completed-project"],
  );
});

test("default projects heading does not label all projects as in progress", () => {
  assert.equal(projectFilters.getProjectsSectionLabel?.("all"), "專案清單");
});
