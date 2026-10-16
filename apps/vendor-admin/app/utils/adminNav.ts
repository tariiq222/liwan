import type { ShellRailItem } from '@nasq/ui/app/types/shell'

/** `alsoUnder`: further path prefixes that belong to this section (workspaces without a customer sit under customers, the retired legacy packages under plans). */
interface AdminNavEntry { id: string, icon: string, capability: string, alsoUnder?: readonly string[] }

// Display order. The control plane enforces every capability; hiding an entry here is presentation only.
const ENTRIES: readonly AdminNavEntry[] = [
  { id: 'overview', icon: 'i-lucide-house', capability: 'vendor.read' },
  { id: 'analytics', icon: 'i-lucide-chart-line', capability: 'vendor.billing.manage' },
  { id: 'customers', icon: 'i-lucide-users', capability: 'vendor.read', alsoUnder: ['/tenants'] },
  { id: 'plans', icon: 'i-lucide-badge-percent', capability: 'vendor.read', alsoUnder: ['/catalog'] },
  { id: 'bundles', icon: 'i-lucide-boxes', capability: 'vendor.read' },
  { id: 'invoices', icon: 'i-lucide-receipt', capability: 'vendor.billing.manage' },
  { id: 'operations', icon: 'i-lucide-wrench', capability: 'vendor.read' },
  { id: 'audit', icon: 'i-lucide-history', capability: 'vendor.audit.read' },
  { id: 'team', icon: 'i-lucide-user-cog', capability: 'vendor.accounts.manage' },
]

const EXTRA_PREFIXES: Record<string, readonly string[] | undefined> = Object.fromEntries(ENTRIES.map(entry => [entry.id, entry.alsoUnder]))

/** The sections these capabilities may see, in display order. */
export function adminNav(capabilities: readonly string[]): ShellRailItem[] {
  return ENTRIES
    .filter(entry => capabilities.includes(entry.capability))
    .map(entry => ({ id: entry.id, labelKey: `app.nav.${entry.id}`, icon: entry.icon, to: `/${entry.id}` }))
}

/** The id of the item whose section contains `path`; the root belongs to the overview. */
export function activeNavId(items: readonly ShellRailItem[], path: string): string | null {
  const target = path.split(/[?#]/, 1)[0]!.replace(/\/+$/, '') || '/'
  if (target === '/') return items.find(item => item.id === 'overview')?.id ?? null
  const within = (prefix: string) => target === prefix || target.startsWith(`${prefix}/`)
  return items.find(item => within(item.to) || EXTRA_PREFIXES[item.id]?.some(within))?.id ?? null
}

const UTILITY_IDS: readonly string[] = ['audit', 'team']

/** The rail's two groups: the commercial sections, then the administration of the console itself. */
export function splitRail(items: readonly ShellRailItem[]): { modules: ShellRailItem[], utility: ShellRailItem[] } {
  return {
    modules: items.filter(item => !UTILITY_IDS.includes(item.id)),
    utility: items.filter(item => UTILITY_IDS.includes(item.id)),
  }
}
