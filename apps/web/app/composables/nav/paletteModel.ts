import type { RouteLocationRaw } from 'vue-router'
// Relative imports: this module is unit-tested directly under plain vitest.
import { canReach, canReachPath, type AccessIdentity } from '../../utils/accessPolicy'
import { appCommands } from '../../modules/surfaces'
import type { AppCommand, AppSearchRow } from '../../modules/types'
import { CHORD_START_KEY } from '@webvue/ui/app/composables/shortcuts/keymap'
import type { NavItem } from './shellModules'

interface ShortcutHelpEntry { id: string; labelKey: string; kbds: readonly string[] }
/** The fixed rows of the `?` help view in reading order; a `G` row per visible go key follows (paletteModel.helpItems). */
export const SHORTCUT_HELP: readonly ShortcutHelpEntry[] = [
  { id: 'palette', labelKey: 'shortcuts.palette', kbds: ['meta', 'K'] },
  { id: 'search', labelKey: 'shortcuts.search', kbds: ['/'] },
  { id: 'create', labelKey: 'shortcuts.create', kbds: ['C'] },
  { id: 'go', labelKey: 'shortcuts.go', kbds: ['G'] },
  { id: 'rows', labelKey: 'shortcuts.rows', kbds: ['J', 'K'] },
  { id: 'open', labelKey: 'shortcuts.open', kbds: ['enter'] },
  { id: 'sidebar', labelKey: 'shortcuts.sidebar', kbds: ['['] },
  { id: 'escape', labelKey: 'shortcuts.escape', kbds: ['escape'] },
  { id: 'help', labelKey: 'shortcuts.help', kbds: ['?'] },
]

/** Rows one search section shows; UCommandPalette cuts every group at `fuse.resultLimit` (default 12). */
export const PALETTE_SECTION_LIMIT = 5

export type PaletteItemAction =
  | { kind: 'shortcuts' }
  | { kind: 'retry'; section: string }
  | { kind: 'none' }

/** One palette row before the component adds its `onSelect`. */
export interface PaletteItem {
  id: string
  label: string
  /** A second line after the label (the account's tax number, the invoice's party). */
  suffix?: string
  icon?: string
  to?: RouteLocationRaw
  kbds?: string[]
  /** The key hint is decoration: hidden from assistive tech so the option's name stays its label. */
  kbdsHidden?: boolean
  loading?: boolean
  disabled?: boolean
  /** Not a link: the palette runs it and stays open. */
  action?: PaletteItemAction
}
export interface PaletteGroup { id: string; label: string; items: PaletteItem[]; ignoreFilter?: boolean }
/** One manifest search provider as the palette renders it (from useAppSearch). */
export interface PaletteSearchSection {
  id: string
  label: string
  icon: string
  rows: readonly AppSearchRow[]
  waiting: boolean
  error: boolean
  hasNext: boolean
  /** The provider's translated `truncatedKey` when it capped its response, else null. */
  notice: string | null
}

/** Every go key that is malformed, reserved or declared twice, as readable findings; empty when consistent. */
export function goKeyProblems(items: readonly Pick<NavItem, 'to' | 'goKey'>[]): string[] {
  const problems: string[] = []
  const owners = new Map<string, string[]>()
  for (const item of items) {
    if (item.goKey === undefined) continue
    if (!/^[a-z]$/.test(item.goKey)) problems.push(`${item.to}: go key "${item.goKey}" is not one lower-case letter`)
    else if (item.goKey === CHORD_START_KEY) problems.push(`${item.to}: go key "${item.goKey}" is reserved`)
    owners.set(item.goKey, [...(owners.get(item.goKey) ?? []), item.to])
  }
  for (const [key, targets] of owners) {
    if (targets.length > 1) problems.push(`go key "${key}" is declared by ${targets.join(' and ')}`)
  }
  return problems
}

/** The destination of each go key among the nav items the user can see (`useNav`). */
export function goKeyTargets(visible: readonly NavItem[]): Map<string, NavItem> {
  const targets = new Map<string, NavItem>()
  for (const item of visible) {
    if (item.goKey && !targets.has(item.goKey)) targets.set(item.goKey, item)
  }
  return targets
}

/**
 * Commands the identity may run: the command's capability with its feature (write for a `/new`
 * path, so a read-only tenant sees none) and the route's own capability, the gate the page itself applies.
 */
export function visibleCommands(identity: AccessIdentity, commands: readonly AppCommand[] = appCommands()): AppCommand[] {
  return commands.filter(command => canReach(identity, command.capability, command.to) && canReachPath(identity, command.to))
}

const goKbds = (key: string) => ['G', key.toUpperCase()]

/** Go to: the nav items the user can see, in rail order, with their `G` letter as a decorative hint. */
export function goToItems(visible: readonly NavItem[], label: (item: NavItem) => string): PaletteItem[] {
  return visible.map(item => ({
    id: `goto:${item.to}`,
    label: label(item),
    icon: item.icon,
    to: item.to,
    ...(item.goKey ? { kbds: goKbds(item.goKey), kbdsHidden: true } : {}),
  }))
}

/** Actions: each visible command opens its form with a return path to where the palette was opened. */
export function commandItems(commands: readonly AppCommand[], label: (key: string) => string, returnTo: string): PaletteItem[] {
  return commands.map(command => ({
    id: `command:${command.id}`,
    label: label(command.labelKey),
    icon: command.icon,
    to: { path: command.to, query: { returnTo } },
    ...(command.shortcut ? { kbds: [command.shortcut], kbdsHidden: true } : {}),
  }))
}

/** The `?` help view: the fixed table, then one `G` row per visible go key in letter order. Keys are read aloud here. */
export function helpItems(visible: readonly NavItem[], label: (key: string) => string, goTo: (item: NavItem) => string): PaletteItem[] {
  const none = { kind: 'none' } as const
  const fixed = SHORTCUT_HELP.map(entry => ({ id: `help:${entry.id}`, label: label(entry.labelKey), kbds: [...entry.kbds], action: none }))
  const go = [...goKeyTargets(visible).entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => ({ id: `help:go:${key}`, label: goTo(item), kbds: goKbds(key), action: none }))
  return [...fixed, ...go]
}

/**
 * The palette's groups (Tasmim spec §5): Go to; while a term is typed, one Search group per
 * provider (not re-filtered by Fuse: the provider already matched); then Actions. The shortcuts
 * view shows only the help. Empty groups are dropped.
 */
export function paletteGroups(input: {
  view: 'main' | 'shortcuts'
  term: string
  goTo: PaletteItem[]
  search: readonly PaletteSearchSection[]
  actions: PaletteItem[]
  help: PaletteItem[]
  returnTo: string
  labels: { goTo: string; actions: string; shortcuts: string; loading: string; error: string; loadMore: string }
}): PaletteGroup[] {
  if (input.view === 'shortcuts') return [{ id: 'shortcuts', label: input.labels.shortcuts, items: input.help }]
  const search = input.term.trim() ? input.search.flatMap((section): PaletteGroup[] => {
    const items: PaletteItem[] = section.rows.slice(0, PALETTE_SECTION_LIMIT).map(row => ({
      id: `search:${section.id}:${row.id}`,
      label: row.label,
      suffix: row.caption,
      icon: section.icon,
      to: { path: row.to, query: { returnTo: input.returnTo } },
    }))
    if (section.notice) items.push({ id: `search:${section.id}:notice`, label: section.notice, icon: 'i-lucide-info', disabled: true })
    if (section.waiting && !section.rows.length) {
      items.push({ id: `search:${section.id}:loading`, label: input.labels.loading, loading: true, disabled: true })
    }
    if (section.error) {
      items.push({ id: `search:${section.id}:error`, label: input.labels.error, icon: 'i-lucide-rotate-cw', action: { kind: 'retry', section: section.id } })
    } else if (section.hasNext || section.rows.length > PALETTE_SECTION_LIMIT) {
      items.push({
        id: `search:${section.id}:more`, label: input.labels.loadMore, icon: 'i-lucide-chevrons-down',
        to: { path: '/search', query: { q: input.term, provider: section.id, returnTo: input.returnTo } },
      })
    }
    return items.length ? [{ id: `search-${section.id}`, label: section.label, items, ignoreFilter: true }] : []
  }) : []
  return [
    { id: 'goto', label: input.labels.goTo, items: input.goTo },
    ...search,
    { id: 'actions', label: input.labels.actions, items: input.actions },
  ].filter(group => group.items.length > 0)
}
