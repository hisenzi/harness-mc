import assert from "node:assert/strict";
import { filterProjectsByDomain, getDisplayedProjects, isProjectComplete } from "../app/projects/projectFilters.mjs";

const projects = [
  {
    project: "house123-buy",
    status: "completed",
    type: "service",
    domain: "Life-Focus",
    done: 9,
    total: 10,
  },
  {
    project: "hc-validation",
    status: "completed",
    type: "knowledge",
    domain: "Harness",
    done: 30,
    total: 30,
  },
  {
    project: "active-service",
    status: "active",
    type: "service",
    domain: "公司",
    done: 1,
    total: 3,
  },
  {
    project: "active-service-same-type",
    status: "active",
    type: "service",
    domain: "Life-Focus",
    done: 1,
    total: 3,
  },
];

assert.equal(isProjectComplete(projects[0]), false, "project.status must not override open tasks");
assert.equal(isProjectComplete(projects[1]), true, "done/total should mark true completion");

assert.deepEqual(
  getDisplayedProjects(projects, "completed").map((project) => project.project),
  ["hc-validation"],
  "completed tab should only include projects where done === total",
);

assert.deepEqual(
  filterProjectsByDomain(projects, "Life-Focus").map((project) => project.project),
  ["house123-buy", "active-service-same-type"],
  "domain filter should use PAI domain, not project.type",
);

assert.deepEqual(
  getDisplayedProjects(projects, "Life-Focus").map((project) => project.project),
  ["house123-buy", "active-service-same-type"],
  "domain tab should show incomplete projects even if project.status is completed",
);

assert.deepEqual(
  getDisplayedProjects(projects, "service").map((project) => project.project),
  [],
  "legacy project.type values should no longer drive /projects filters",
);

console.log("Projects filter verification OK");
