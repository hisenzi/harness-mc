export function isProjectComplete(project) {
  return Number(project.total) > 0 && Number(project.done) === Number(project.total);
}

export function filterProjectsByDomain(projects, domainFilter) {
  if (domainFilter === "all") return projects;
  if (domainFilter === "completed") return projects.filter(isProjectComplete);
  return projects.filter((project) => project.domain === domainFilter);
}

export function getDisplayedProjects(projects, domainFilter) {
  return filterProjectsByDomain(projects, domainFilter);
}

export function getProjectsSectionLabel(domainFilter) {
  return domainFilter === "completed" ? "已完成" : "專案清單";
}
