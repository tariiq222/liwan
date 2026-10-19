import type { RouteLocationRaw } from 'vue-router'
// Relative imports: the `@/` alias does not resolve for value imports under a
// plain `vitest run`, and this module is unit-tested directly.
import { normalizedPath, projectIdFromPath } from './activeRoute'
import type { NavIcon } from './projectSections'

/** A preset of the page's list: a link whose query the page already understands. */
export interface QuickViewLink { id: string; labelKey: string; icon: NavIcon; to: RouteLocationRaw; active: boolean }
/** An action of the page; the primary one is the create action, rendered with a plus chip. */
export interface QuickActionLink extends QuickViewLink { primary: boolean }
export interface QuickViewsModel { views: QuickViewLink[]; actions: QuickActionLink[] }

export interface QuickViewsInput {
  path: string
  query: Record<string, unknown>
  can: (capability: string) => boolean
  /** The shell's create target (carries the return path); the same function the context sidebar uses. */
  createTo: (link: { id: string; to: string }) => RouteLocationRaw
}

type Preset = Record<string, string>
interface ViewSpec { id: string; labelKey: string; icon: NavIcon; preset: Preset }
interface ActionSpec { id: string; labelKey: string; icon: NavIcon; preset: Preset }
interface ListSpec {
  path: string
  /** Query keys the presets own: a view is active when every one of them equals the preset's value (or is absent). */
  presetKeys: readonly string[]
  /** Query keys a preset link carries over, so choosing a view does not switch the page's layout. */
  keepKeys?: readonly string[]
  views: ViewSpec[]
  /** Preset actions (archived lists): links to the same list with another scope. */
  actions?: Array<ActionSpec & { capability?: string }>
}

const EMPTY: QuickViewsModel = { views: [], actions: [] }

function firstValue(value: unknown): string | undefined {
  const first = Array.isArray(value) ? value[0] : value
  return typeof first === 'string' ? first : undefined
}

function pickKept(query: Record<string, unknown>, keys: readonly string[] = []): Preset {
  return Object.fromEntries(keys.flatMap((key) => {
    const value = firstValue(query[key])
    return value === undefined ? [] : [[key, value] as const]
  }))
}

/** True when the URL holds exactly this preset for every key the presets own; a page that ignores a key still compares by URL. */
function presetActive(query: Record<string, unknown>, keys: readonly string[], preset: Preset): boolean {
  return keys.every(key => firstValue(query[key]) === preset[key])
}

function presetLink(spec: ListSpec, preset: Preset, query: Record<string, unknown>): RouteLocationRaw {
  return { path: spec.path, query: { ...pickKept(query, spec.keepKeys), ...preset } }
}

function listModel(spec: ListSpec, input: QuickViewsInput): Pick<QuickViewsModel, 'views'> & { presetActions: QuickActionLink[] } {
  const views = spec.views.map(view => ({
    id: view.id,
    labelKey: view.labelKey,
    icon: view.icon,
    to: presetLink(spec, view.preset, input.query),
    active: presetActive(input.query, spec.presetKeys, view.preset),
  }))
  const presetActions = (spec.actions ?? [])
    .filter(action => !action.capability || input.can(action.capability))
    .map(action => ({
      id: action.id,
      labelKey: action.labelKey,
      icon: action.icon,
      to: presetLink(spec, action.preset, input.query),
      active: presetActive(input.query, spec.presetKeys, action.preset),
      primary: false,
    }))
  return { views, presetActions }
}

function createAction(input: QuickViewsInput, capability: string, id: string, labelKey: string, to: string, primary: boolean): QuickActionLink[] {
  if (!input.can(capability)) return []
  return [{ id, labelKey, icon: 'i-lucide-plus', to: input.createTo({ id, to }), active: false, primary }]
}

// Task presets. The keys assignee, deadline and priority are read by the tasks filters; the page may not honour them yet,
// the links are built with exactly these keys regardless. `closed` and `scope` are already understood by the list.
const TASK_VIEWS: ViewSpec[] = [
  { id: 'assigned', labelKey: 'tasks.quickViews.assigned', icon: 'i-lucide-user', preset: { assignee: 'me' } },
  { id: 'today', labelKey: 'tasks.quickViews.today', icon: 'i-lucide-sun', preset: { deadline: 'today' } },
  { id: 'week', labelKey: 'tasks.quickViews.week', icon: 'i-lucide-calendar-range', preset: { deadline: 'week' } },
  { id: 'overdue', labelKey: 'tasks.quickViews.overdue', icon: 'i-lucide-circle-alert', preset: { deadline: 'overdue' } },
  { id: 'urgent', labelKey: 'tasks.quickViews.urgent', icon: 'i-lucide-flame', preset: { priority: '3' } },
  { id: 'done', labelKey: 'tasks.quickViews.done', icon: 'i-lucide-circle-check', preset: { closed: '1' } },
]
const TASK_PRESET_KEYS = ['assignee', 'deadline', 'priority', 'closed', 'scope'] as const

const PROJECT_LIST: ListSpec = {
  path: '/projects',
  presetKeys: ['mine', 'status', 'archived'],
  keepKeys: ['view'],
  views: [
    { id: 'mine', labelKey: 'nav.myProjects', icon: 'i-lucide-user-round', preset: { mine: '1' } },
    { id: 'at-risk', labelKey: 'projects.status.at_risk', icon: 'i-lucide-triangle-alert', preset: { status: 'at_risk' } },
    { id: 'off-track', labelKey: 'projects.status.off_track', icon: 'i-lucide-trending-down', preset: { status: 'off_track' } },
    { id: 'on-hold', labelKey: 'projects.status.on_hold', icon: 'i-lucide-circle-pause', preset: { status: 'on_hold' } },
    { id: 'done', labelKey: 'projects.status.done', icon: 'i-lucide-circle-check', preset: { status: 'done' } },
  ],
  // The list shows archived projects only to a manager (the server's can_list_archived); a stale link settles on the active list.
  actions: [{ id: 'archived-projects', labelKey: 'projects.filters.archived', icon: 'i-lucide-archive', preset: { archived: '1' }, capability: 'pmo.projects.manage' }],
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
  path: '/settings/users',
  presetKeys: ['status'],
  views: [
    { id: 'active', labelKey: 'access.active', icon: 'i-lucide-user-check', preset: { status: 'active' } },
    { id: 'stopped', labelKey: 'access.disabled', icon: 'i-lucide-user-x', preset: { status: 'stopped' } },
  ],
}

const MEETING_PATHS: ReadonlySet<string> = new Set(['/meetings', '/meetings/calendar', '/meetings/series', '/meetings/follow-up'])
const OPERATION_PATHS: ReadonlySet<string> = new Set(['/operations', '/operations/pending', '/operations/monitoring', '/operations/processes'])

function taskList(input: QuickViewsInput, path: string, base: string, withArchived: boolean): QuickViewsModel {
  const spec: ListSpec = { path: base, presetKeys: TASK_PRESET_KEYS, keepKeys: ['view'], views: TASK_VIEWS }
  const { views } = listModel(spec, input)
  const creating = path === `${base}/new`
  const archived: QuickActionLink[] = withArchived
    ? [{
        id: 'archived-tasks',
        labelKey: 'taskLifecycle.archivedTasks',
        icon: 'i-lucide-archive',
        to: { path: base, query: { scope: 'archived' } },
        active: firstValue(input.query.scope) === 'archived',
        primary: false,
      }]
    : []
  return { views, actions: [...(creating ? [] : createAction(input, 'pmo.tasks.create', 'new-task-pmo', 'tasks.new', `${base}/new`, true)), ...archived] }
}

/**
 * The second shell card: quick views (presets of the current list, each a route the page already understands)
 * and actions (create and archive), by path. A page without either gets an empty model and the shell shows no card.
 */
export function quickViewsModel(input: QuickViewsInput): QuickViewsModel {
  const path = normalizedPath(input.path)
  const projectId = projectIdFromPath(path)

  if (path === '/tasks' || path === '/tasks/new') return taskList(input, path, '/tasks', true)
  if (projectId !== null && (path === `/projects/${projectId}/tasks` || path === `/projects/${projectId}/tasks/new`)) {
    return taskList(input, path, `/projects/${projectId}/tasks`, false)
  }

  if (path === '/projects') {
    const { views, presetActions } = listModel(PROJECT_LIST, input)
    return { views, actions: presetActions }
  }

  if (MEETING_PATHS.has(path)) {
    const views = path === '/meetings' ? listModel(MEETING_LIST, input).views : []
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
      ...(input.can('documents.items.archive') ? [{ id: 'archived-documents', labelKey: 'documents.archived', icon: 'i-lucide-archive' as NavIcon, to: { path: '/documents', query: { archived: '1' } }, active: input.query.archived === '1', primary: false }] : []),
    ],
  }
  if (path === '/hr' || path === '/hr/departments') {
    const onDepartments = path === '/hr/departments'
    return { views: [], actions: [
      ...createAction(input, 'hr.employees.manage', 'new-employee', 'hr.directory.newEmployee', '/hr/employees/new', !onDepartments),
      ...createAction(input, 'hr.departments.manage', 'new-department', 'hr.depts.new', '/hr/departments/new', onDepartments),
    ].sort((a, b) => Number(b.primary) - Number(a.primary)) }
  }

  if (path === '/hr/leave') {
    return {
      views: [],
      actions: [
        ...createAction(input, 'hr.leave.request', 'new-leave', 'hr.leave.new', '/hr/leave/new', true),
        ...createAction(input, 'hr.leave.manage', 'new-leave-allocation', 'hr.leave.allocate', '/hr/leave/allocations/new', false),
      ],
    }
  }

  if (OPERATION_PATHS.has(path)) {
    const onProcesses = path === '/operations/processes'
    return {
      views: [],
      actions: [
        ...createAction(input, 'operations.requests.create', 'new-operation', 'operations.newRequest', '/operations/new', !onProcesses),
        ...createAction(input, 'operations.processes.manage', 'new-operation-process', 'operations.newProcess', '/operations/processes/new', onProcesses),
      ].sort((a, b) => Number(b.primary) - Number(a.primary)),
    }
  }

  if (path === '/settings/users') {
    return { views: listModel(USER_LIST, input).views, actions: createAction(input, 'access.users.grant', 'new-user', 'access.users.grantAccount', '/settings/users/new', true) }
  }
  if (path === '/settings/roles') {
    return { views: [], actions: createAction(input, 'access.roles.manage', 'new-role', 'access.roles.create', '/settings/roles/new', true) }
  }
  return EMPTY
}
