// Copying a project needs the server's create signal (it also covers the company policy that lets every
// employee create projects) and the right to read the tasks that get copied.
export function canCopyProject(hasProject: boolean, serverCanCreate: boolean | undefined, canReadTasks: boolean): boolean {
  return hasProject && serverCanCreate === true && canReadTasks
}
