export function isProjectComplete(project) {
  return Number(project.total) > 0 && Number(project.done) === Number(project.total);
}

export function filterProjectsByType(projects, typeFilter) {
  if (typeFilter === "all") return projects;
  if (typeFilter === "completed") return projects.filter(isProjectComplete);
  return projects.filter((project) => project.type === typeFilter);
}

export function getDisplayedProjects(projects, typeFilter) {
  const filtered = filterProjectsByType(projects, typeFilter);
  if (typeFilter === "completed") return filtered;
  return filtered.filter((project) => !isProjectComplete(project));
}
