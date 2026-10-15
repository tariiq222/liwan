/** Workspace routes keep a stable frame (no entrance motion, workspace spacing); chat, login and meeting print do not. */
export function isWorkspaceThemeRoute(path: string): boolean {
  return !/^\/(?:chat|login)(\/|$)/.test(path) && !/^\/meetings\/[1-9]\d*\/print\/?$/.test(path)
}
