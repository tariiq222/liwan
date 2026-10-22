/** Pages that sit in the shell without a context sidebar: nothing to list there, so the frame gives its width to the page. */
const NO_CONTEXT_PREFIXES = ['/account', '/notifications', '/search', '/apps', '/services']

export function hasNoContextSidebar(path: string): boolean {
  return path === '/' || NO_CONTEXT_PREFIXES.some(prefix => path === prefix || path.startsWith(`${prefix}/`))
}
