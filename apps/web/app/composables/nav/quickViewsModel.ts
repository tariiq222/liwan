import type { RouteLocationRaw } from 'vue-router'
// Relative imports: the `@/` alias does not resolve for value imports under a
// plain `vitest run`, and this module is unit-tested directly.
import { normalizedPath } from '../../utils/routePath'
import type { AppIcon } from '../../modules/types'

/** A preset of the page's list: a link whose query the page already understands. */
export interface QuickViewLink { id: string; labelKey: string; icon: AppIcon; to: RouteLocationRaw; active: boolean }
/** An action of the page; the primary one is the create action, rendered with a plus chip. */
export interface QuickActionLink extends QuickViewLink { primary: boolean }
export interface QuickViewsModel { views: QuickViewLink[]; actions: QuickActionLink[] }

export interface QuickViewsInput {
  path: string
  query: Record<string, unknown>
  can: (capability: string) => boolean
  /** The shell's create target (carries the return path); the same function the sidebar uses. */
  createTo: (link: { id: string; to: string }) => RouteLocationRaw
}

type Preset = Record<string, string>
interface ViewSpec { id: string; labelKey: string; icon: AppIcon; preset: Preset }
interface ListSpec {
  path: string
  /** Query keys the presets own: a view is active when every one of them equals the preset's value (or is absent). */
  presetKeys: readonly string[]
  views: ViewSpec[]
}

const EMPTY: QuickViewsModel = { views: [], actions: [] }

function firstValue(value: unknown): string | undefined {
  const first = Array.isArray(value) ? value[0] : value
  return typeof first === 'string' ? first : undefined
}

/** True when the URL holds exactly this preset for every key the presets own; a page that ignores a key still compares by URL. */
function presetActive(query: Record<string, unknown>, keys: readonly string[], preset: Preset): boolean {
  return keys.every(key => firstValue(query[key]) === preset[key])
}

function listModel(spec: ListSpec, query: Record<string, unknown>): Pick<QuickViewsModel, 'views'> {
  const views = spec.views.map(view => ({
    id: view.id,
    labelKey: view.labelKey,
    icon: view.icon,
    to: { path: spec.path, query: view.preset },
    active: presetActive(query, spec.presetKeys, view.preset),
  }))
  return { views }
}

function createAction(input: QuickViewsInput, capability: string, id: string, labelKey: string, to: string, primary: boolean): QuickActionLink[] {
  if (!input.can(capability)) return []
  return [{ id, labelKey, icon: 'i-lucide-plus', to: input.createTo({ id, to }), active: false, primary }]
}

const MEETING_LIST: ListSpec = {
  path: '/meetings',
  presetKeys: ['mine', 'state'],
  views: [
    { id: 'mine', labelKey: 'meetingsUi.mine', icon: 'i-lucide-user-round', preset: { mine: '1' } },
    { id: 'draft', labelKey: 'meetingsUi.state.draft', icon: 'i-lucide-file-pen', preset: { state: 'draft' } },
    { id: 'confirmed', labelKey: 'meetingsUi.state.confirmed', icon: 'i-lucide-calendar-check', preset: { state: 'confirmed' } },
    { id: 'done', labelKey: 'meetingsUi.state.done', icon: 'i-lucide-circle-check', preset: { state: 'done' } },
  ],
}

const USER_LIST: ListSpec = {
  path: '/settings/team/users',
  presetKeys: ['status'],
  views: [
    { id: 'active', labelKey: 'access.active', icon: 'i-lucide-user-check', preset: { status: 'active' } },
    { id: 'stopped', labelKey: 'access.disabled', icon: 'i-lucide-user-x', preset: { status: 'stopped' } },
  ],
}

const MEETING_PATHS: ReadonlySet<string> = new Set(['/meetings', '/meetings/calendar', '/meetings/series', '/meetings/follow-up'])
const OPERATION_PATHS: ReadonlySet<string> = new Set(['/operations', '/operations/pending', '/operations/monitoring', '/settings/apps/operations/processes'])

/**
 * The second shell card: quick views (presets of the current list, each a route the page already understands)
 * and actions (create and archive), by path. A page without either gets an empty model and the shell shows no card.
 */
export function quickViewsModel(input: QuickViewsInput): QuickViewsModel {
  const path = normalizedPath(input.path)

  if (MEETING_PATHS.has(path)) {
    const views = path === '/meetings' ? listModel(MEETING_LIST, input.query).views : []
    return {
      views,
      actions: [
        ...createAction(input, 'meetings.create', 'new-meeting', 'nav.newMeeting', '/meetings/new', true),
        ...createAction(input, 'meetings.create', 'new-meeting-series', 'meetingsUi.newSeries', '/meetings/series/new', false),
      ],
    }
  }

  if (path === '/documents') return {
    views: [], actions: [
      ...createAction(input, 'documents.items.manage', 'new-document', 'documents.new', '/documents/new', true),
      ...(input.can('documents.items.archive') ? [{ id: 'archived-documents', labelKey: 'documents.archived', icon: 'i-lucide-archive' as AppIcon, to: { path: '/documents', query: { archived: '1' } }, active: input.query.archived === '1', primary: false }] : []),
    ],
  }
  if (OPERATION_PATHS.has(path)) {
    const onProcesses = path === '/settings/apps/operations/processes'
    return {
      views: [],
      actions: [
        ...createAction(input, 'operations.requests.create', 'new-operation', 'operations.newRequest', '/operations/new', !onProcesses),
        ...createAction(input, 'operations.processes.manage', 'new-operation-process', 'operations.newProcess', '/settings/apps/operations/processes/new', onProcesses),
      ].sort((a, b) => Number(b.primary) - Number(a.primary)),
    }
  }

  if (path === '/settings/team/users') {
    return { views: listModel(USER_LIST, input.query).views, actions: createAction(input, 'access.users.grant', 'new-user', 'access.users.grantAccount', '/settings/team/users/new', true) }
  }
  if (path === '/settings/team/roles') {
    return { views: [], actions: createAction(input, 'access.roles.manage', 'new-role', 'access.roles.create', '/settings/team/roles/new', true) }
  }
  return EMPTY
}
