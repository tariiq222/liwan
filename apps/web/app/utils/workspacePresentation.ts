/** Portaled menus and toasts follow the active module; chat keeps its design. */
export function isWorkspaceThemeRoute(path: string): boolean {
  return !/^\/(?:chat|login)(\/|$)/.test(path) && !/^\/meetings\/[1-9]\d*\/print\/?$/.test(path)
}
