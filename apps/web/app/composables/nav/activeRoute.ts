// Type-only: `ShellModule` lives with the rail model, and erasing this import
// keeps the runtime dependency one-way (shellModules -> activeRoute).
import type { ShellModule } from './shellModules'
import { manifestForPath } from '../../modules/manifests'
import type { AppManifest } from '../../modules/types'
import { normalizedPath } from '../../utils/routePath'

/** The rail module of a path an application owns: its most specific nav item, else the application's default rail. */
function moduleWithinApp(manifest: AppManifest, path: string): ShellModule {
  const pathname = normalizedPath(path)
  const item = [...manifest.nav]
    .sort((a, b) => b.to.length - a.to.length)
    .find(candidate => pathname === candidate.to || pathname.startsWith(`${candidate.to}/`))
  if (item) return item.module ?? manifest.id
  const fallback = manifest.defaultRail ?? manifest.id
  return manifest.rail.some(entry => entry.id === fallback) ? fallback : manifest.rail[0]?.id ?? fallback
}

export function activeShellModule(path: string): ShellModule | null {
  if (normalizedPath(path) === '/') return 'home'
  const owner = manifestForPath(path)
  if (owner) return moduleWithinApp(owner, path)
  if (path === '/settings' || path.startsWith('/settings/')) return 'settings'
  if (path === '/subscription' || path.startsWith('/subscription/')) return 'settings'
  // The account is reached from the header menu, not from a rail module.
  if (path === '/account' || path.startsWith('/account/')) return null
  if (path === '/search' || path.startsWith('/search/')) return null
  if (path === '/notifications' || path.startsWith('/notifications/')) return null
  if (path === '/notification-digests' || path.startsWith('/notification-digests/')) return null
  return null
}

/** The module whose contextual links a rail module shows; `home` shares the projects sidebar. */
export function contextModuleFor(module: ShellModule | null): ShellModule | null {
  return module === 'home' ? null : module
}
