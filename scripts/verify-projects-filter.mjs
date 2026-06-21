import assert from "node:assert/strict";
import { getDisplayedProjects, isProjectComplete } from "../app/projects/projectFilters.mjs";

const projects = [
  {
    project: "house123-buy",
    status: "completed",
    type: "service",
    done: 9,
    total: 10,
  },
  {
    project: "hc-validation",
    status: "completed",
    type: "knowledge",
    done: 30,
    total: 30,
  },
  {
    project: "active-service",
    status: "active",
    type: "service",
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
  getDisplayedProjects(projects, "service").map((project) => project.project),
  ["house123-buy", "active-service"],
  "service tab should show incomplete service projects even if project.status is completed",
);

console.log("Projects filter verification OK");
