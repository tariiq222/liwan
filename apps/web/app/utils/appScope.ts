/**
 * The application whose identity (tile colour, button shade, accent) the page and its teleported overlays wear. An
 * application's settings page (`/settings/apps/<id>`) takes that application's identity; any other page takes the open
 * module (home, search and account have none).
 */
export function appScopeFor(path: string, activeModule: string | null | undefined): string | undefined {
  const settingsApp = /^\/settings\/apps\/([a-z0-9_-]+)/.exec(path)?.[1]
  return settingsApp ?? (typeof activeModule === 'string' ? activeModule : undefined)
}
