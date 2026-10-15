/** Chat, login and meeting print keep their own frame: no workspace theme (stable spacing, no entrance motion). */
export function isPlainRoute(path: string): boolean {
  return /^\/(?:chat|login)(\/|$)/.test(path) || /^\/meetings\/[1-9]\d*\/print\/?$/.test(path)
}
