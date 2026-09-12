# Navigation Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the project workspace's two-row grouped tabs and the route-backed side panel with one flat seven-tab row whose sections are real routes, and full-page records everywhere.

**Architecture:** Each project section becomes a child route under `pages/projects/[id]/`, so `pages/projects/[id].vue` shrinks to a frame (identity row + tab strip + `<NuxtPage/>`). Because the path now names the section, the overlay machinery that reconstructed a background route from chained `returnTo` values is deleted rather than ported. Navigation data moves out of the 454-line `useNav.ts` into three single-responsibility modules under `app/composables/nav/`.

**Tech Stack:** Nuxt 4 (file-based routing, `definePageMeta`), Vue 3 `<script setup>`, Nuxt UI, `@tanstack/vue-query`, Vitest (`@nuxt/test-utils`), Playwright.

**Spec:** [docs/superpowers/specs/2026-09-12-navigation-simplification-design.md](../specs/2026-09-12-navigation-simplification-design.md)

## Global Constraints

- Work only in `apps/web`. No change to `/api/v1` contracts, Odoo addons, `packages/contracts`, or the 28 capabilities.
- Arabic (`ar`) is default and RTL-first. Every user-facing string uses `$t()`/`t()` from the owning per-pillar locale file under `apps/web/i18n/locales/{ar,en}`. A pillar's `nav.*` label is the deliberate shared `common.json` exception.
- Tailwind logical properties only: `ms-`, `me-`, `ps-`, `pe-`, `start-`, `end-`, `text-start`. Never `ml-`, `pl-`, `left-`.
- Icons via `UIcon` with `i-lucide-*` names. Decorative icons get `aria-hidden="true"`; icon-only buttons get `:aria-label`.
- Authenticated interactive controls that must not lose a first click during SSR hydration use the shared `useHydrated()` composable and stay disabled until hydrated. Do not substitute a per-component `mounted` flag.
- Every link carries a `capability` and is filtered through `hasCapability(identity, capability)` from `@/utils/accessPolicy`.
- Task state names on the wire are unchanged: `in_progress | changes_requested | approved | waiting | done | cancelled`.
- Run checks from `apps/web`. Unit: `npm test`. Types: `npx -w apps/web vue-tsc --noEmit` (run from repo root). E2E: `npm run test:e2e`. UI policy: `python3 -B tools/ui_policy.py` from repo root.
- Commit after every task. Never rewrite history.
- Retained DESIGN.md §5 exceptions — do NOT convert these to pages: global search (centered dialog), notification bell popover, `SharedUnsavedChanges`, in-page delete confirmation. Chat and meeting print stay outside these rules.

---

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `app/composables/nav/projectSections.ts` | The seven project sections: id, label key, icon, path, capability. Single source. |
| `app/composables/nav/shellModules.ts` | Module rail definitions and per-module context links. |
| `app/composables/nav/activeRoute.ts` | Derives active module and active project section from a path. |
| `app/composables/nav/createActions.ts` | The shared pinned-create link builders (`listReturnTo`, `createTo`). |
| `app/pages/projects/[id]/index.vue` | Project summary section. |
| `app/pages/projects/[id]/tasks/index.vue` | Project task list section. |
| `app/pages/projects/[id]/milestones/index.vue` | Project milestones section. |
| `app/pages/projects/[id]/governance.vue` | Governance index with four cards. |
| `app/middleware/project-tab-redirect.global.ts` | Translates legacy `?tab=` links to section paths. |

**Modified:**

| Path | Change |
|---|---|
| `app/pages/projects/[id].vue` | Shrinks to frame: identity row, tab strip, `<NuxtPage/>`. |
| `app/components/project/workspace/ProjectWorkspaceTabs.vue` | One flat row; no groups, no sub-row. |
| `app/composables/useNav.ts` | Re-exports from `nav/*`; dead exports deleted. |
| `app/composables/useShellNavigation.ts` | Drops breadcrumb and overlay support. |
| `app/components/shell/ContextSidebar.vue` | Breadcrumb removed; create actions imported. |
| `app/components/shell/MobileNavigation.vue` | Duplicated functions removed; imports shared ones. |
| `app/components/shared/PageHeader.vue` | One back rule; suppression list deleted. |
| `app/components/task/TaskDetailPanel.vue` | Overlay injection removed; back link always renders. |
| `app/utils/workspacePresentation.ts` | Only `isWorkspaceThemeRoute` survives. |
| `DESIGN.md` | §4 and §5 rewritten; §6 gains the nested tab strip. |

**Deleted:** `app/components/project/workspace/ProjectRouteHost.vue`, `ProjectRouteModal.vue`, `app/utils/projectOverlayRoute.ts`, `app/utils/workspaceBreadcrumbs.ts`, `app/utils/projectBreadcrumbs.ts`, and their `__tests__` files.

---

## Task 1: Project sections model

**Files:**
- Create: `apps/web/app/composables/nav/projectSections.ts`
- Test: `apps/web/app/composables/nav/__tests__/projectSections.test.ts`

**Interfaces:**
- Consumes: `hasCapability`, `AccessIdentity` from `@/utils/accessPolicy`; `NavIcon` from `@/composables/useNav`.
- Produces:
  - `PROJECT_SECTION_IDS: readonly ['summary','tasks','schedule','milestones','governance','finance','updates']`
  - `type ProjectSectionId = typeof PROJECT_SECTION_IDS[number]`
  - `interface ProjectSection { id: ProjectSectionId; labelKey: string; icon: NavIcon; to: string; capability: string }`
  - `projectSections(projectId: number, identity: AccessIdentity, options: { active: boolean; canManage: boolean }): ProjectSection[]`

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/composables/nav/__tests__/projectSections.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { PROJECT_SECTION_IDS, projectSections } from '../projectSections'

const reader = { role: 'employee', capabilities: ['pmo.projects.read', 'pmo.tasks.read'] }
const projectOnly = { role: 'employee', capabilities: ['pmo.projects.read'] }
const opts = { active: true, canManage: false }

describe('projectSections', () => {
  it('declares the seven sections in reading order', () => {
    expect(PROJECT_SECTION_IDS).toEqual(['summary', 'tasks', 'schedule', 'milestones', 'governance', 'finance', 'updates'])
  })

  it('maps every section to its own path', () => {
    expect(projectSections(7, reader, opts).map(s => s.to)).toEqual([
      '/projects/7',
      '/projects/7/tasks',
      '/projects/7/schedule',
      '/projects/7/milestones',
      '/projects/7/governance',
      '/projects/7/finance',
      '/projects/7/updates',
    ])
  })

  it('hides task-backed sections without pmo.tasks.read', () => {
    expect(projectSections(7, projectOnly, opts).map(s => s.id)).toEqual(['summary', 'governance', 'finance', 'updates'])
  })

  it('an archived project keeps only read-only sections', () => {
    expect(projectSections(7, reader, { active: false, canManage: false }).map(s => s.id)).toEqual(['summary', 'schedule', 'finance', 'updates'])
  })

  it('returns nothing before capabilities arrive', () => {
    expect(projectSections(7, undefined, opts)).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run app/composables/nav/__tests__/projectSections.test.ts`
Expected: FAIL — cannot resolve `../projectSections`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/app/composables/nav/projectSections.ts`:

```ts
import { hasCapability, type AccessIdentity } from '@/utils/accessPolicy'
import type { NavIcon } from '@/composables/useNav'

export const PROJECT_SECTION_IDS = ['summary', 'tasks', 'schedule', 'milestones', 'governance', 'finance', 'updates'] as const
export type ProjectSectionId = typeof PROJECT_SECTION_IDS[number]

export interface ProjectSection {
  id: ProjectSectionId
  labelKey: string
  icon: NavIcon
  to: string
  capability: string
}

/** Sections hidden on an archived project: everything that mutates or plans work. */
const ARCHIVED_HIDDEN: readonly ProjectSectionId[] = ['tasks', 'milestones', 'governance']

const DEFINITIONS: Array<Omit<ProjectSection, 'to'> & { segment: string }> = [
  { id: 'summary', labelKey: 'nav.projectSummary', icon: 'i-lucide-layout-dashboard', segment: '', capability: 'pmo.projects.read' },
  { id: 'tasks', labelKey: 'nav.projectTasks', icon: 'i-lucide-clipboard-list', segment: '/tasks', capability: 'pmo.tasks.read' },
  { id: 'schedule', labelKey: 'projects.planningLinks.schedule', icon: 'i-lucide-calendar-range', segment: '/schedule', capability: 'pmo.projects.read' },
  { id: 'milestones', labelKey: 'projects.tabs.milestones', icon: 'i-lucide-flag', segment: '/milestones', capability: 'pmo.tasks.read' },
  { id: 'governance', labelKey: 'projects.workspace.groups.governance', icon: 'i-lucide-shield-check', segment: '/governance', capability: 'pmo.projects.read' },
  { id: 'finance', labelKey: 'nav.projectFinance', icon: 'i-lucide-wallet-cards', segment: '/finance', capability: 'pmo.projects.read' },
  { id: 'updates', labelKey: 'projects.tabs.updates', icon: 'i-lucide-megaphone', segment: '/updates', capability: 'pmo.projects.read' },
]

export function projectSections(
  projectId: number,
  identity: AccessIdentity,
  options: { active: boolean; canManage: boolean },
): ProjectSection[] {
  void options.canManage
  return DEFINITIONS
    .filter(definition => options.active || !ARCHIVED_HIDDEN.includes(definition.id))
    .filter(definition => hasCapability(identity, definition.capability))
    .map(({ segment, ...rest }) => ({ ...rest, to: `/projects/${projectId}${segment}` }))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run app/composables/nav/__tests__/projectSections.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/composables/nav/projectSections.ts apps/web/app/composables/nav/__tests__/projectSections.test.ts
git commit -m "feat(web): add one source for the seven project sections

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: Active section derivation

**Files:**
- Create: `apps/web/app/composables/nav/activeRoute.ts`
- Test: `apps/web/app/composables/nav/__tests__/activeRoute.test.ts`

**Interfaces:**
- Consumes: `ProjectSectionId`, `PROJECT_SECTION_IDS` from Task 1.
- Produces:
  - `projectIdFromPath(path: string): number | null`
  - `activeProjectSection(path: string): ProjectSectionId | null` — `null` when the path is not inside a project.

`activeShellModule` stays in `useNav.ts` for now; Task 16 moves it here.

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/composables/nav/__tests__/activeRoute.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { activeProjectSection, projectIdFromPath } from '../activeRoute'

describe('projectIdFromPath', () => {
  it('reads a positive integer id', () => {
    expect(projectIdFromPath('/projects/12/tasks')).toBe(12)
  })
  it('rejects non-numeric and non-positive ids', () => {
    expect(projectIdFromPath('/projects/abc')).toBeNull()
    expect(projectIdFromPath('/projects/0')).toBeNull()
    expect(projectIdFromPath('/projects')).toBeNull()
  })
})

describe('activeProjectSection', () => {
  it('maps the project root to the summary', () => {
    expect(activeProjectSection('/projects/12')).toBe('summary')
    expect(activeProjectSection('/projects/12/')).toBe('summary')
  })
  it('maps each section root to itself', () => {
    expect(activeProjectSection('/projects/12/tasks')).toBe('tasks')
    expect(activeProjectSection('/projects/12/schedule')).toBe('schedule')
    expect(activeProjectSection('/projects/12/milestones')).toBe('milestones')
    expect(activeProjectSection('/projects/12/governance')).toBe('governance')
    expect(activeProjectSection('/projects/12/finance')).toBe('finance')
    expect(activeProjectSection('/projects/12/updates')).toBe('updates')
  })
  it('keeps a record page on its owning section', () => {
    expect(activeProjectSection('/projects/12/tasks/99')).toBe('tasks')
    expect(activeProjectSection('/projects/12/finance/5/edit')).toBe('finance')
    expect(activeProjectSection('/projects/12/schedule/tasks/99')).toBe('schedule')
  })
  it('maps the four governance children to governance', () => {
    expect(activeProjectSection('/projects/12/charter')).toBe('governance')
    expect(activeProjectSection('/projects/12/stakeholders')).toBe('governance')
    expect(activeProjectSection('/projects/12/stakeholders/3/edit')).toBe('governance')
    expect(activeProjectSection('/projects/12/raci')).toBe('governance')
    expect(activeProjectSection('/projects/12/register/8')).toBe('governance')
  })
  it('returns null for settings and for paths outside a project', () => {
    expect(activeProjectSection('/projects/12/settings')).toBeNull()
    expect(activeProjectSection('/projects')).toBeNull()
    expect(activeProjectSection('/tasks/99')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run app/composables/nav/__tests__/activeRoute.test.ts`
Expected: FAIL — cannot resolve `../activeRoute`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/app/composables/nav/activeRoute.ts`:

```ts
import type { ProjectSectionId } from './projectSections'

function normalized(path: string): string {
  return path.split(/[?#]/, 1)[0]!.replace(/\/+$/, '') || '/'
}

export function projectIdFromPath(path: string): number | null {
  const match = normalized(path).match(/^\/projects\/([^/]+)/)
  const parsed = match ? Number(match[1]) : NaN
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

/** The four governance children keep their own top-level paths. */
const GOVERNANCE_SEGMENTS = new Set(['charter', 'stakeholders', 'raci', 'register'])

const SECTION_SEGMENTS = new Set<ProjectSectionId>(['tasks', 'schedule', 'milestones', 'governance', 'finance', 'updates'])

export function activeProjectSection(path: string): ProjectSectionId | null {
  const id = projectIdFromPath(path)
  if (id === null) return null
  const rest = normalized(path).replace(`/projects/${id}`, '').replace(/^\//, '')
  if (!rest) return 'summary'
  const head = rest.split('/', 1)[0]!
  if (GOVERNANCE_SEGMENTS.has(head)) return 'governance'
  return SECTION_SEGMENTS.has(head as ProjectSectionId) ? head as ProjectSectionId : null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run app/composables/nav/__tests__/activeRoute.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/composables/nav/activeRoute.ts apps/web/app/composables/nav/__tests__/activeRoute.test.ts
git commit -m "feat(web): derive the active project section from the path alone

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: Legacy `?tab=` redirect

**Files:**
- Create: `apps/web/app/middleware/project-tab-redirect.global.ts`
- Create: `apps/web/app/utils/legacyProjectTab.ts`
- Test: `apps/web/app/utils/__tests__/legacyProjectTab.test.ts`

**Interfaces:**
- Consumes: `projectIdFromPath` from Task 2.
- Produces: `legacyProjectTabTarget(path: string, query: Record<string, unknown>): { path: string; query: Record<string, string> } | null` — `null` when no redirect is needed.

The pure function is unit-tested; the middleware is a three-line adapter so no separate test is needed for it.

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/utils/__tests__/legacyProjectTab.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { legacyProjectTabTarget } from '../legacyProjectTab'

describe('legacyProjectTabTarget', () => {
  it('sends tab=tasks to the tasks section', () => {
    expect(legacyProjectTabTarget('/projects/7', { tab: 'tasks' })).toEqual({ path: '/projects/7/tasks', query: {} })
  })
  it('turns tab=board and tab=list into the view parameter', () => {
    expect(legacyProjectTabTarget('/projects/7', { tab: 'board' })).toEqual({ path: '/projects/7/tasks', query: { view: 'board' } })
    expect(legacyProjectTabTarget('/projects/7', { tab: 'list' })).toEqual({ path: '/projects/7/tasks', query: { view: 'list' } })
  })
  it('sends tab=milestones and tab=summary to their sections', () => {
    expect(legacyProjectTabTarget('/projects/7', { tab: 'milestones' })).toEqual({ path: '/projects/7/milestones', query: {} })
    expect(legacyProjectTabTarget('/projects/7', { tab: 'summary' })).toEqual({ path: '/projects/7', query: {} })
  })
  it('treats a bare view=board as the tasks section', () => {
    expect(legacyProjectTabTarget('/projects/7', { view: 'board' })).toEqual({ path: '/projects/7/tasks', query: { view: 'board' } })
  })
  it('carries filters through and drops the dead state keys', () => {
    const target = legacyProjectTabTarget('/projects/7', { tab: 'tasks', q: 'عقد', state: 'in_progress', taskContext: '{"q":"x"}', projectListReturnTo: '/projects', returnTo: '/projects' })
    expect(target).toEqual({ path: '/projects/7/tasks', query: { q: 'عقد', state: 'in_progress' } })
  })
  it('leaves already-migrated and non-project routes alone', () => {
    expect(legacyProjectTabTarget('/projects/7/tasks', { view: 'board' })).toBeNull()
    expect(legacyProjectTabTarget('/projects/7', {})).toBeNull()
    expect(legacyProjectTabTarget('/tasks', { tab: 'tasks' })).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run app/utils/__tests__/legacyProjectTab.test.ts`
Expected: FAIL — cannot resolve `../legacyProjectTab`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/app/utils/legacyProjectTab.ts`:

```ts
import { projectIdFromPath } from '@/composables/nav/activeRoute'

/** Query keys the old workspace carried that the section path now expresses. */
const DEAD_KEYS = ['tab', 'taskContext', 'projectListReturnTo', 'returnTo']

function firstString(value: unknown): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value
  return typeof raw === 'string' ? raw : undefined
}

export function legacyProjectTabTarget(
  path: string,
  query: Record<string, unknown>,
): { path: string; query: Record<string, string> } | null {
  const id = projectIdFromPath(path)
  if (id === null) return null
  if ((path.replace(/\/+$/, '') || '/') !== `/projects/${id}`) return null

  const tab = firstString(query.tab)
  const view = firstString(query.view)
  let segment: string | null = null
  let nextView: string | undefined

  if (tab === 'tasks') segment = '/tasks'
  else if (tab === 'board' || tab === 'list') { segment = '/tasks'; nextView = tab }
  else if (tab === 'milestones') segment = '/milestones'
  else if (tab === 'summary') segment = ''
  else if (!tab && view === 'board') { segment = '/tasks'; nextView = 'board' }

  if (segment === null) return null

  const nextQuery: Record<string, string> = {}
  for (const [key, raw] of Object.entries(query)) {
    if (DEAD_KEYS.includes(key) || key === 'view') continue
    const value = firstString(raw)
    if (value !== undefined) nextQuery[key] = value
  }
  if (nextView) nextQuery.view = nextView

  return { path: `/projects/${id}${segment}`, query: nextQuery }
}
```

Create `apps/web/app/middleware/project-tab-redirect.global.ts`:

```ts
import { legacyProjectTabTarget } from '@/utils/legacyProjectTab'

// A 302, not a 301: a permanent redirect is cached by the browser and cannot
// be withdrawn if the section path ever changes again.
export default defineNuxtRouteMiddleware(to => {
  const target = legacyProjectTabTarget(to.path, to.query as Record<string, unknown>)
  if (target) return navigateTo(target, { replace: true, redirectCode: 302 })
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run app/utils/__tests__/legacyProjectTab.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/utils/legacyProjectTab.ts apps/web/app/utils/__tests__/legacyProjectTab.test.ts apps/web/app/middleware/project-tab-redirect.global.ts
git commit -m "feat(web): redirect legacy project tab links to section paths

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: Flat tab strip component

**Files:**
- Modify: `apps/web/app/components/project/workspace/ProjectWorkspaceTabs.vue` (full rewrite, currently 72 lines)
- Modify: `apps/web/app/assets/css/components.css` (append the nested strip modifier)
- Test: `apps/web/app/components/project/workspace/__tests__/ProjectWorkspaceTabs.test.ts`

**Interfaces:**
- Consumes: `projectSections`, `ProjectSection` (Task 1); `activeProjectSection` (Task 2).
- Produces: component props `{ projectId: number; active?: boolean; canManage?: boolean }` — unchanged from today, so `pages/projects/[id].vue` needs no prop change.

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/components/project/workspace/__tests__/ProjectWorkspaceTabs.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ProjectWorkspaceTabs from '../ProjectWorkspaceTabs.vue'

describe('ProjectWorkspaceTabs', () => {
  it('renders one strip and never a sub-row', async () => {
    const wrapper = await mountSuspended(ProjectWorkspaceTabs, {
      props: { projectId: 7, active: true, canManage: true },
      route: '/projects/7/tasks',
    })
    expect(wrapper.findAll('[data-testid="project-workspace-tabs"]')).toHaveLength(1)
    expect(wrapper.find('[data-testid="project-workspace-subtabs"]').exists()).toBe(false)
  })

  it('marks exactly the active section with aria-current', async () => {
    const wrapper = await mountSuspended(ProjectWorkspaceTabs, {
      props: { projectId: 7, active: true, canManage: true },
      route: '/projects/7/governance',
    })
    const current = wrapper.findAll('[aria-current="page"]')
    expect(current).toHaveLength(1)
    expect(wrapper.find('[data-testid="project-tab-governance"]').attributes('aria-current')).toBe('page')
  })

  it('keeps a governance child on the governance tab', async () => {
    const wrapper = await mountSuspended(ProjectWorkspaceTabs, {
      props: { projectId: 7, active: true, canManage: true },
      route: '/projects/7/stakeholders',
    })
    expect(wrapper.find('[data-testid="project-tab-governance"]').attributes('aria-current')).toBe('page')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run app/components/project/workspace/__tests__/ProjectWorkspaceTabs.test.ts`
Expected: FAIL — `project-workspace-subtabs` still exists and `project-tab-governance` is not found (today's ids are group ids).

- [ ] **Step 3: Write minimal implementation**

Replace the entire contents of `apps/web/app/components/project/workspace/ProjectWorkspaceTabs.vue`:

```vue
<script setup lang="ts">
import { projectSections } from '@/composables/nav/projectSections'
import { activeProjectSection } from '@/composables/nav/activeRoute'
import { useProject } from '@/composables/useProjects'

const props = defineProps<{
  projectId: number
  active?: boolean
  canManage?: boolean
}>()

const route = useRoute()
const { t } = useI18n()
const { me } = useMe()
const hydrated = useHydrated()
const projectId = computed(() => Number.isInteger(props.projectId) && props.projectId > 0 ? props.projectId : null)
const projectQuery = useProject(projectId)
// Server and first client render must produce the same tab set.
const projectData = computed(() => hydrated.value ? projectQuery.data.value : undefined)
const activeProject = computed(() => props.active ?? projectData.value?.active ?? true)
const canManage = computed(() => props.canManage ?? projectData.value?.can_manage ?? false)
const sections = computed(() => projectSections(props.projectId, me.value, { active: activeProject.value, canManage: canManage.value }))
const current = computed(() => activeProjectSection(route.path))
</script>

<template>
  <nav
    v-if="sections.length"
    class="nasq-ui-tab-strip"
    data-testid="project-workspace-tabs"
    :aria-label="t('projects.workspace.tabsLabel')"
  >
    <UButton
      v-for="section in sections"
      :key="section.id"
      color="neutral"
      variant="ghost"
      class="nasq-ui-tab"
      :to="section.to"
      :aria-current="current === section.id ? 'page' : undefined"
      :data-active="current === section.id"
      :data-testid="`project-tab-${section.id}`"
    >
      <UIcon :name="section.icon" aria-hidden="true" class="size-4" />
      <span>{{ t(section.labelKey) }}</span>
    </UButton>
  </nav>
</template>
```

Append to `apps/web/app/assets/css/components.css`:

```css
/* A record's own sections sit under the project sections. Quieter and smaller
   so two strips read as two levels rather than one crowded row. */
.nasq-ui-tab-strip--nested .nasq-ui-tab {
  font-size: var(--nasq-font-support);
  color: var(--ui-text-muted);
}
.nasq-ui-tab-strip--nested .nasq-ui-tab[data-active='true'] {
  color: var(--ui-text-highlighted);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run app/components/project/workspace/__tests__/ProjectWorkspaceTabs.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/components/project/workspace/ProjectWorkspaceTabs.vue apps/web/app/components/project/workspace/__tests__/ProjectWorkspaceTabs.test.ts apps/web/app/assets/css/components.css
git commit -m "feat(web): flatten the project tabs into one row

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: Split the project page into frame and summary

**Files:**
- Modify: `apps/web/app/pages/projects/[id].vue` (203 lines → ~70)
- Create: `apps/web/app/pages/projects/[id]/index.vue`
- Test: `apps/web/app/pages/__tests__/projectWorkspaceFrame.test.ts`

**Interfaces:**
- Consumes: `ProjectWorkspaceTabs` (Task 4); `activeProjectSection`, `projectIdFromPath` (Task 2).
- Produces: the frame provides nothing via inject; children read the project from `useProject` themselves (the query is cached, so this is one request).

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/pages/__tests__/projectWorkspaceFrame.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ProjectFrame from '../projects/[id].vue'

describe('project workspace frame', () => {
  it('shows the identity row and the tab strip on a section route', async () => {
    const wrapper = await mountSuspended(ProjectFrame, { route: '/projects/7/tasks' })
    expect(wrapper.find('[data-testid="project-workspace-identity"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="project-workspace-tabs"]').exists()).toBe(true)
  })

  it('renders exactly one h1 on a section route', async () => {
    const wrapper = await mountSuspended(ProjectFrame, { route: '/projects/7/tasks' })
    expect(wrapper.findAll('h1')).toHaveLength(1)
  })

  it('hides the frame on the settings page', async () => {
    const wrapper = await mountSuspended(ProjectFrame, { route: '/projects/7/settings' })
    expect(wrapper.find('[data-testid="project-workspace-tabs"]').exists()).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run app/pages/__tests__/projectWorkspaceFrame.test.ts`
Expected: FAIL — the second test finds two `h1` elements (frame title plus the inline section header).

- [ ] **Step 3: Write minimal implementation**

Replace `apps/web/app/pages/projects/[id].vue` entirely:

```vue
<script setup lang="ts">
import ProjectStatusBadge from '@/components/project/ProjectStatusBadge.vue'
import ProjectWorkspaceTabs from '@/components/project/workspace/ProjectWorkspaceTabs.vue'
import { ApiError } from '@/composables/useApi'
import { activeProjectSection, projectIdFromPath } from '@/composables/nav/activeRoute'
import { useProject } from '@/composables/useProjects'

const route = useRoute()
const { t } = useI18n()
const hydrated = useHydrated()
const projectId = computed(() => projectIdFromPath(route.path))
const { data: projectData, isLoading, error } = useProject(projectId)
// Queries may finish after server rendering but before payload dehydration.
// Keep the first client tree identical to SSR, then reveal the cached project.
const project = computed(() => hydrated.value ? projectData.value : undefined)
const notFound = computed(() => projectId.value === null || (error.value instanceof ApiError && (error.value.status === 404 || error.value.status === 403)))
// The frame belongs to the seven sections and their records; project settings
// is a standalone page inside the workspace and owns its own header.
const showFrame = computed(() => !notFound.value && activeProjectSection(route.path) !== null)
const settingsTo = computed(() => `/projects/${projectId.value}/settings`)
</script>

<template>
  <div class="flex flex-col gap-6">
    <SharedPageContainer v-if="showFrame" width="list" data-testid="project-workspace-frame">
      <div class="flex flex-col gap-4">
        <div class="flex min-h-9 flex-wrap items-start justify-between gap-3" data-testid="project-workspace-identity">
          <div v-if="project" class="min-w-0">
            <h1 class="truncate text-xl font-semibold text-highlighted" data-testid="project-workspace-name">{{ project.name }}</h1>
            <p class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
              <ProjectStatusBadge :status="project.status" />
              <span v-if="project.manager" class="inline-flex items-center gap-1.5">
                <UIcon name="i-lucide-user-round" class="size-4" aria-hidden="true" />
                <span class="sr-only">{{ t('projects.columns.manager') }}: </span>{{ project.manager.name }}
              </span>
            </p>
          </div>
          <USkeleton v-else-if="isLoading || !hydrated" class="h-9 w-1/3" />
          <UButton
            v-if="project?.can_manage"
            square
            color="neutral"
            variant="outline"
            icon="i-lucide-settings"
            class="ms-auto"
            data-testid="project-workspace-settings"
            :to="settingsTo"
            :aria-label="t('nav.projectSettings')"
            :title="t('nav.projectSettings')"
          />
        </div>
        <!-- Tabs follow the hydrated project like the title row, so a first click is a client-side navigation. -->
        <ProjectWorkspaceTabs v-if="project" :project-id="projectId!" :active="project.active" :can-manage="project.can_manage" />
        <USkeleton v-else-if="isLoading || !hydrated" class="h-8 w-2/3" />
      </div>
    </SharedPageContainer>
    <NuxtPage />
  </div>
</template>
```

Create `apps/web/app/pages/projects/[id]/index.vue` — move the summary branch out of the old page:

```vue
<script setup lang="ts">
import ProjectOverview from '@/components/project/ProjectOverview.vue'
import { projectIdFromPath } from '@/composables/nav/activeRoute'
import { useProject } from '@/composables/useProjects'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const projectId = computed(() => projectIdFromPath(route.path))
const { data: projectData, isLoading, error, refetch } = useProject(projectId)
const project = computed(() => hydrated.value ? projectData.value : undefined)
const canCreate = computed(() => project.value?.can_manage === true)

function openUpdateCreate() {
  router.push(`/projects/${projectId.value}/updates/new`)
}
</script>

<template>
  <SharedPageContainer width="list">
    <SharedPageState v-if="error" :error="error" @retry="refetch" />
    <template v-else>
      <SharedPageHeader v-if="project" :title="t('nav.projectSummary')">
        <UButton
          v-if="canCreate && project.active"
          icon="i-lucide-plus"
          data-testid="project-header-create"
          :disabled="!hydrated"
          :label="t('projects.updates.add')"
          @click="openUpdateCreate"
        />
      </SharedPageHeader>
      <USkeleton v-else-if="isLoading || !hydrated" class="h-9 w-1/2" />
      <ProjectOverview v-if="project" :project="project" />
    </template>
  </SharedPageContainer>
</template>
```

`SharedPageHeader` sets the shell title through `usePageHeader` but its `<h1>` is inside the child; the frame's `<h1>` is the project name. Two `h1` elements would fail the test, so `SharedPageHeader` must render its title as `<h2>` when a frame is present — Task 15 removes that ambiguity permanently. For now, pass `:title` and let Task 15 fix the level; the test above asserts the frame's `h1` count on a route whose child has not yet been created, so it passes at this point.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run app/pages/__tests__/projectWorkspaceFrame.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/pages/projects/\[id\].vue apps/web/app/pages/projects/\[id\]/index.vue apps/web/app/pages/__tests__/projectWorkspaceFrame.test.ts
git commit -m "refactor(web): make the project page a frame with a summary child

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: Tasks section page

**Files:**
- Create: `apps/web/app/pages/projects/[id]/tasks/index.vue`
- Test: `apps/web/app/pages/__tests__/projectTasksSection.test.ts`

**Interfaces:**
- Consumes: `projectTaskParams`, `projectTaskQuery` from `@/composables/projectTaskParams`; `TaskTable`, `TaskBoard`, `TaskToolbar`; `projectIdFromPath` (Task 2).
- Produces: the route `/projects/:id/tasks` with `?view=list|board` and the task filter keys `q`, `state`, `closed`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/pages/__tests__/projectTasksSection.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import TasksSection from '../projects/[id]/tasks/index.vue'

describe('project tasks section', () => {
  it('defaults to the table view', async () => {
    const wrapper = await mountSuspended(TasksSection, { route: '/projects/7/tasks' })
    expect(wrapper.find('[data-testid="task-table"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="task-board"]').exists()).toBe(false)
  })

  it('honours view=board', async () => {
    const wrapper = await mountSuspended(TasksSection, { route: '/projects/7/tasks?view=board' })
    expect(wrapper.find('[data-testid="task-board"]').exists()).toBe(true)
  })

  it('links a task row to a sibling path with no returnTo', async () => {
    const wrapper = await mountSuspended(TasksSection, { route: '/projects/7/tasks?q=عقد' })
    const vm = wrapper.vm as unknown as { taskTo: (id: number) => { path: string; query: Record<string, unknown> } }
    expect(vm.taskTo(99)).toEqual({ path: '/projects/7/tasks/99', query: { q: 'عقد' } })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run app/pages/__tests__/projectTasksSection.test.ts`
Expected: FAIL — cannot resolve `../projects/[id]/tasks/index.vue`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/app/pages/projects/[id]/tasks/index.vue`:

```vue
<script setup lang="ts">
import type { LocationQueryRaw } from 'vue-router'
import TaskBoard from '@/components/task/TaskBoard.vue'
import TaskTable from '@/components/task/TaskTable.vue'
import TaskToolbar from '@/components/task/TaskToolbar.vue'
import { projectTaskParams, projectTaskQuery } from '@/composables/projectTaskParams'
import { projectIdFromPath } from '@/composables/nav/activeRoute'
import { useProject } from '@/composables/useProjects'
import type { TaskListParams } from '@/composables/useTasks'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const projectId = computed(() => projectIdFromPath(route.path))
const { data: projectData, error, refetch } = useProject(projectId)
const project = computed(() => hydrated.value ? projectData.value : undefined)
const isBoard = computed(() => route.query.view === 'board')
const params = computed<TaskListParams>(() => projectTaskParams(projectId.value!, route.query))
const stageSource = computed(() => ({ kind: 'project' as const, stages: project.value?.stages ?? [] }))
const canCreate = computed(() => can('pmo.tasks.create'))

function onParams(value: TaskListParams) {
  router.replace({ query: { ...route.query, ...projectTaskQuery(value) } })
}

// The section path already names where a close returns to, so a record link
// carries only the filters that decide list order.
function taskTo(taskId: number): { path: string; query: LocationQueryRaw } {
  const { view: _view, ...filters } = route.query
  return { path: `/projects/${projectId.value}/tasks/${taskId}`, query: filters as LocationQueryRaw }
}

function viewTo(view: 'list' | 'board') {
  const query: LocationQueryRaw = { ...route.query }
  if (view === 'board') query.view = 'board'
  else delete query.view
  return { path: route.path, query }
}

function openCreate() {
  router.push({ path: `/projects/${projectId.value}/tasks/new`, query: taskTo(0).query })
}

defineExpose({ taskTo })
</script>

<template>
  <SharedPageContainer width="list">
    <SharedPageState v-if="error" :error="error" @retry="refetch" />
    <template v-else>
      <SharedPageHeader :title="t('nav.projectTasks')">
        <UButton
          v-if="canCreate && project?.active"
          icon="i-lucide-plus"
          data-testid="project-header-create"
          :disabled="!hydrated"
          :label="t('tasks.new')"
          @click="openCreate"
        />
      </SharedPageHeader>
      <section class="min-w-0 space-y-4" :aria-label="t('projects.tabs.tasks')">
        <TaskToolbar :model-value="params" embedded collapsible hide-project-filter @update:model-value="onParams">
          <template #view>
            <nav class="nasq-ui-segment" :aria-label="t('projects.planning.views')">
              <UButton color="neutral" size="sm" icon="i-lucide-list" :variant="isBoard ? 'ghost' : 'soft'" :to="viewTo('list')" :aria-current="isBoard ? undefined : 'page'">{{ t('projects.tabs.list') }}</UButton>
              <UButton color="neutral" size="sm" icon="i-lucide-layout-grid" :variant="isBoard ? 'soft' : 'ghost'" :to="viewTo('board')" :aria-current="isBoard ? 'page' : undefined">{{ t('projects.tabs.board') }}</UButton>
            </nav>
          </template>
        </TaskToolbar>
        <div class="nasq-ui-record-surface">
          <TaskTable v-if="!isBoard" :params="params" variant="project" embedded @open="(id: number) => router.push(taskTo(id))" @create="openCreate" />
          <TaskBoard v-else :params="params" :stage-source="stageSource" embedded @open="(id: number) => router.push(taskTo(id))" />
        </div>
        <div class="flex justify-end">
          <NuxtLink :to="{ path: '/archived-tasks', query: { project_id: projectId } }" class="text-sm text-muted hover:underline">{{ t('taskLifecycle.archivedTasks') }}</NuxtLink>
        </div>
      </section>
    </template>
  </SharedPageContainer>
</template>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run app/pages/__tests__/projectTasksSection.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/pages/projects/\[id\]/tasks/index.vue apps/web/app/pages/__tests__/projectTasksSection.test.ts
git commit -m "feat(web): give the project task list its own route

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: Milestones section page

**Files:**
- Create: `apps/web/app/pages/projects/[id]/milestones/index.vue`
- Test: `apps/web/app/pages/__tests__/projectMilestonesSection.test.ts`

**Interfaces:**
- Consumes: `MilestoneTable` from `@/components/project/MilestoneTable.vue`; `projectIdFromPath` (Task 2).
- Produces: the route `/projects/:id/milestones`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/pages/__tests__/projectMilestonesSection.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import MilestonesSection from '../projects/[id]/milestones/index.vue'

describe('project milestones section', () => {
  it('renders the milestone table', async () => {
    const wrapper = await mountSuspended(MilestonesSection, { route: '/projects/7/milestones' })
    expect(wrapper.find('[data-testid="milestone-table"]').exists()).toBe(true)
  })

  it('offers create only to a manager', async () => {
    const wrapper = await mountSuspended(MilestonesSection, { route: '/projects/7/milestones' })
    const button = wrapper.find('[data-testid="project-header-create"]')
    expect(button.exists()).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run app/pages/__tests__/projectMilestonesSection.test.ts`
Expected: FAIL — cannot resolve `../projects/[id]/milestones/index.vue`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/app/pages/projects/[id]/milestones/index.vue`:

```vue
<script setup lang="ts">
import MilestoneTable from '@/components/project/MilestoneTable.vue'
import { projectIdFromPath } from '@/composables/nav/activeRoute'
import { useProject } from '@/composables/useProjects'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const projectId = computed(() => projectIdFromPath(route.path))
const { data: projectData, error, refetch } = useProject(projectId)
const project = computed(() => hydrated.value ? projectData.value : undefined)
const canCreate = computed(() => project.value?.can_manage === true && project.value?.active === true)

function openCreate() {
  router.push(`/projects/${projectId.value}/milestones/new`)
}
</script>

<template>
  <SharedPageContainer width="list">
    <SharedPageState v-if="error" :error="error" @retry="refetch" />
    <template v-else>
      <SharedPageHeader :title="t('projects.tabs.milestones')">
        <UButton
          v-if="canCreate"
          icon="i-lucide-plus"
          data-testid="project-header-create"
          :disabled="!hydrated"
          :label="t('projects.milestones.new')"
          @click="openCreate"
        />
      </SharedPageHeader>
      <MilestoneTable v-if="project" :project-id="project.id" :can-manage="project.can_manage" embedded />
    </template>
  </SharedPageContainer>
</template>
```

Verify `MilestoneTable.vue` has `data-testid="milestone-table"` on its root; if it does not, add it in the same commit.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run app/pages/__tests__/projectMilestonesSection.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/pages/projects/\[id\]/milestones/index.vue apps/web/app/pages/__tests__/projectMilestonesSection.test.ts apps/web/app/components/project/MilestoneTable.vue
git commit -m "feat(web): give project milestones their own route

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 8: Governance index page

**Files:**
- Create: `apps/web/app/pages/projects/[id]/governance.vue`
- Modify: `apps/web/i18n/locales/ar/projects.json`, `apps/web/i18n/locales/en/projects.json`
- Test: `apps/web/app/pages/__tests__/projectGovernance.test.ts`

**Interfaces:**
- Consumes: `projectIdFromPath` (Task 2); `hasCapability` from `@/utils/accessPolicy`.
- Produces: the route `/projects/:id/governance`; four cards linking to `/charter`, `/stakeholders`, `/raci`, `/register`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/pages/__tests__/projectGovernance.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import Governance from '../projects/[id]/governance.vue'

describe('project governance index', () => {
  it('links to the four governance sections', async () => {
    const wrapper = await mountSuspended(Governance, { route: '/projects/7/governance' })
    const hrefs = wrapper.findAll('a').map(a => a.attributes('href'))
    expect(hrefs).toEqual([
      '/projects/7/charter',
      '/projects/7/stakeholders',
      '/projects/7/raci',
      '/projects/7/register',
    ])
  })

  it('renders one h1', async () => {
    const wrapper = await mountSuspended(Governance, { route: '/projects/7/governance' })
    expect(wrapper.findAll('h1')).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run app/pages/__tests__/projectGovernance.test.ts`
Expected: FAIL — cannot resolve `../projects/[id]/governance.vue`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/app/pages/projects/[id]/governance.vue`:

```vue
<script setup lang="ts">
import { projectIdFromPath } from '@/composables/nav/activeRoute'
import { hasCapability } from '@/utils/accessPolicy'

const route = useRoute()
const { t } = useI18n()
const { me } = useMe()
const projectId = computed(() => projectIdFromPath(route.path))

const cards = computed(() => [
  { id: 'charter', labelKey: 'nav.projectCharter', descriptionKey: 'projects.governance.charterHint', icon: 'i-lucide-file-text', segment: 'charter' },
  { id: 'stakeholders', labelKey: 'nav.projectStakeholders', descriptionKey: 'projects.governance.stakeholdersHint', icon: 'i-lucide-users', segment: 'stakeholders' },
  { id: 'raci', labelKey: 'projects.workspace.sections.raci', descriptionKey: 'projects.governance.raciHint', icon: 'i-lucide-grid-3x3', segment: 'raci' },
  { id: 'risks', labelKey: 'nav.projectRisks', descriptionKey: 'projects.governance.risksHint', icon: 'i-lucide-circle-alert', segment: 'register' },
].filter(() => hasCapability(me.value, 'pmo.projects.read')))
</script>

<template>
  <SharedPageContainer width="list">
    <SharedPageHeader :title="t('projects.workspace.groups.governance')" />
    <div class="grid gap-4 sm:grid-cols-2">
      <NuxtLink
        v-for="card in cards"
        :key="card.id"
        :to="`/projects/${projectId}/${card.segment}`"
        class="nasq-ui-record-surface flex items-start gap-3 p-4 transition-colors hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        :data-testid="`governance-card-${card.id}`"
      >
        <UIcon :name="card.icon" class="size-5 shrink-0 text-muted" aria-hidden="true" />
        <span class="min-w-0">
          <span class="block font-medium text-highlighted">{{ t(card.labelKey) }}</span>
          <span class="mt-1 block text-sm text-muted">{{ t(card.descriptionKey) }}</span>
        </span>
      </NuxtLink>
    </div>
  </SharedPageContainer>
</template>
```

Add to `apps/web/i18n/locales/ar/projects.json` under the existing `governance` object (create it if absent):

```json
"governance": {
  "charterHint": "نطاق المشروع وأهدافه ومبرراته.",
  "stakeholdersHint": "الأطراف المعنية وأدوارها ووسائل التواصل معها.",
  "raciHint": "من ينفّذ ومن يملك القرار في كل مهمة.",
  "risksHint": "المخاطر والمشكلات المفتوحة وخطط معالجتها."
}
```

Add the English counterpart to `apps/web/i18n/locales/en/projects.json`:

```json
"governance": {
  "charterHint": "Project scope, objectives, and justification.",
  "stakeholdersHint": "Interested parties, their roles, and how to reach them.",
  "raciHint": "Who does the work and who owns the decision on each task.",
  "risksHint": "Open risks and issues with their treatment plans."
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run app/pages/__tests__/projectGovernance.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/pages/projects/\[id\]/governance.vue apps/web/app/pages/__tests__/projectGovernance.test.ts apps/web/i18n/locales/ar/projects.json apps/web/i18n/locales/en/projects.json
git commit -m "feat(web): add the governance index page

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 9: Governance children return to the index

**Files:**
- Modify: `apps/web/app/pages/projects/[id]/charter.vue`
- Modify: `apps/web/app/pages/projects/[id]/stakeholders/index.vue`
- Modify: `apps/web/app/pages/projects/[id]/raci.vue`
- Modify: `apps/web/app/pages/projects/[id]/register/index.vue`
- Test: `apps/web/app/pages/__tests__/governanceChildBack.test.ts`

**Interfaces:**
- Consumes: `projectIdFromPath` (Task 2).
- Produces: each of the four pages passes `:back-to="`/projects/${projectId}/governance`"` to `SharedPageHeader`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/pages/__tests__/governanceChildBack.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import Charter from '../projects/[id]/charter.vue'
import Stakeholders from '../projects/[id]/stakeholders/index.vue'
import Raci from '../projects/[id]/raci.vue'
import Register from '../projects/[id]/register/index.vue'

const cases = [
  ['charter', Charter, '/projects/7/charter'],
  ['stakeholders', Stakeholders, '/projects/7/stakeholders'],
  ['raci', Raci, '/projects/7/raci'],
  ['register', Register, '/projects/7/register'],
] as const

describe('governance children', () => {
  it.each(cases)('%s goes back to the governance index', async (_name, component, route) => {
    const wrapper = await mountSuspended(component, { route })
    const back = wrapper.find('[data-slot="page-header"] a')
    expect(back.attributes('href')).toBe('/projects/7/governance')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run app/pages/__tests__/governanceChildBack.test.ts`
Expected: FAIL — the back link is absent or points at a `returnTo`-derived path.

- [ ] **Step 3: Write minimal implementation**

In each of the four pages, add near the top of `<script setup>` (importing `projectIdFromPath` if not already present):

```ts
import { projectIdFromPath } from '@/composables/nav/activeRoute'

const governanceTo = computed(() => `/projects/${projectIdFromPath(route.path)}/governance`)
```

and on the page's `SharedPageHeader`, add:

```
:back-to="governanceTo"
:back-label="$t('projects.workspace.groups.governance')"
```

Remove any existing `returnTo`-derived back computation on these four pages, and delete the now-unused `safeReturnTo` imports.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run app/pages/__tests__/governanceChildBack.test.ts`
Expected: PASS, 4 cases.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/pages/projects/\[id\]/charter.vue apps/web/app/pages/projects/\[id\]/stakeholders/index.vue apps/web/app/pages/projects/\[id\]/raci.vue apps/web/app/pages/projects/\[id\]/register/index.vue apps/web/app/pages/__tests__/governanceChildBack.test.ts
git commit -m "feat(web): send governance children back to their index

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 10: Delete the project overlay host

**Files:**
- Delete: `apps/web/app/components/project/workspace/ProjectRouteHost.vue`
- Delete: `apps/web/app/components/project/workspace/ProjectRouteModal.vue`
- Delete: `apps/web/app/utils/projectOverlayRoute.ts`
- Delete: `apps/web/app/utils/__tests__/projectOverlayRoute.test.ts`
- Modify: `apps/web/app/components/task/TaskDetailPanel.vue`
- Modify: `apps/web/app/components/shared/UnsavedChanges.vue`
- Modify: `apps/web/app/pages/hr/employees/[employeeId]/access.vue`
- Test: `apps/web/app/components/task/__tests__/taskDetailBack.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `TaskDetailPanel` no longer injects `PROJECT_OVERLAY_INJECTION_KEY`; its back link renders unconditionally when `backTo` is supplied.

Find every reference first: `grep -rn "PROJECT_OVERLAY_INJECTION_KEY\|projectOverlayRoute\|ProjectRouteHost\|ProjectRouteModal\|fullPage" apps/web/app`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/components/task/__tests__/taskDetailBack.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import TaskDetailPanel from '../TaskDetailPanel.vue'

describe('task detail back link', () => {
  it('always renders a back link inside a project', async () => {
    const wrapper = await mountSuspended(TaskDetailPanel, {
      props: { taskId: 99, basePath: '/projects/7/tasks', backTo: '/projects/7/tasks' },
      route: '/projects/7/tasks/99',
    })
    const back = wrapper.find('a[href="/projects/7/tasks"]')
    expect(back.exists()).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run app/components/task/__tests__/taskDetailBack.test.ts`
Expected: FAIL — `v-if="!inProjectOverlay"` suppresses the link when the injection default is read.

- [ ] **Step 3: Write minimal implementation**

In `apps/web/app/components/task/TaskDetailPanel.vue`:
- delete the `import { inject } from 'vue'` line and the `import { PROJECT_OVERLAY_INJECTION_KEY } from '@/utils/projectOverlayRoute'` line;
- delete `const inProjectOverlay = inject<boolean>(PROJECT_OVERLAY_INJECTION_KEY, false)`;
- change `<NuxtLink v-if="!inProjectOverlay" :to="backTo"` to `<NuxtLink :to="backTo"`.

In `apps/web/app/components/shared/UnsavedChanges.vue` and `apps/web/app/pages/hr/employees/[employeeId]/access.vue`, remove the `PROJECT_OVERLAY_INJECTION_KEY` import, the `inject` call, and any branch guarded by it — keep the non-overlay branch.

Delete the four files listed above.

Then run `grep -rn "projectOverlayRoute\|PROJECT_OVERLAY_INJECTION_KEY\|ProjectRouteHost\|ProjectRouteModal" apps/web/app` and fix any remaining import until it returns nothing.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run app/components/task/__tests__/taskDetailBack.test.ts && npx vue-tsc --noEmit -p .`
Expected: test PASS; type check reports no unresolved import.

- [ ] **Step 5: Commit**

```bash
git add -A apps/web/app
git commit -m "refactor(web): delete the project overlay host and its route model

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 11: Delete the workspace overlay background derivation

**Files:**
- Modify: `apps/web/app/utils/workspacePresentation.ts` (80 lines → ~8)
- Modify: `apps/web/app/layouts/default.vue`
- Modify: `apps/web/app/pages/tasks/[id].vue`
- Modify: `apps/web/app/pages/projects/[id]/tasks/[taskId].vue`
- Test: `apps/web/app/utils/__tests__/workspacePresentation.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `workspacePresentation.ts` exports only `isWorkspaceThemeRoute(path: string): boolean`.

- [ ] **Step 1: Write the failing test**

Replace `apps/web/app/utils/__tests__/workspacePresentation.test.ts` entirely:

```ts
import { describe, it, expect } from 'vitest'
import * as presentation from '../workspacePresentation'

describe('workspacePresentation', () => {
  it('exports only the theme predicate', () => {
    expect(Object.keys(presentation).sort()).toEqual(['isWorkspaceThemeRoute'])
  })

  it('keeps chat, login and meeting print off the workspace theme', () => {
    expect(presentation.isWorkspaceThemeRoute('/projects/7/tasks')).toBe(true)
    expect(presentation.isWorkspaceThemeRoute('/chat/3')).toBe(false)
    expect(presentation.isWorkspaceThemeRoute('/login')).toBe(false)
    expect(presentation.isWorkspaceThemeRoute('/meetings/4/print')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run app/utils/__tests__/workspacePresentation.test.ts`
Expected: FAIL — the module still exports five names.

- [ ] **Step 3: Write minimal implementation**

Replace `apps/web/app/utils/workspacePresentation.ts` entirely:

```ts
/** Portaled menus and toasts follow the active module; chat keeps its design. */
export function isWorkspaceThemeRoute(path: string): boolean {
  return !/^\/(?:chat|login)(\/|$)/.test(path) && !/^\/meetings\/[1-9]\d*\/print\/?$/.test(path)
}
```

In `apps/web/app/pages/tasks/[id].vue`, replace the `closeTo` computation with a constant target and drop `safeReturnTo`:

```ts
const backTo = computed(() => ({ path: '/tasks', query: route.query }))
```

and pass `:back-to="backTo"` to `TaskDetailPage` in place of `:close-to`.

In `apps/web/app/pages/projects/[id]/tasks/[taskId].vue`, replace the `closeTo` computation likewise:

```ts
const backTo = computed(() => ({ path: `/projects/${projectId.value}/tasks`, query: route.query }))
```

Rename the `close-to` prop on `TaskDetailPage` to `back-to` in the component and both call sites.

In `apps/web/app/layouts/default.vue`, confirm the `isWorkspaceThemeRoute` import still resolves and that nothing else was imported from this module.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run app/utils/__tests__/workspacePresentation.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add -A apps/web/app
git commit -m "refactor(web): derive a record's back target from its own path

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 12: Remove the breadcrumb from the shell

**Files:**
- Modify: `apps/web/app/components/shell/ContextSidebar.vue`
- Modify: `apps/web/app/composables/useShellNavigation.ts`
- Delete: `apps/web/app/utils/workspaceBreadcrumbs.ts`
- Delete: `apps/web/app/utils/projectBreadcrumbs.ts`
- Delete: `apps/web/app/utils/__tests__/workspaceBreadcrumbs.test.ts`, `apps/web/app/utils/__tests__/projectBreadcrumbs.test.ts`
- Modify: `apps/web/app/assets/css/shell.css` (delete `.nasq-project-breadcrumb` rules)
- Test: `apps/web/app/components/shell/__tests__/shellStructure.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `useShellNavigation` returns `{ activeModule, module, projectId, project, contextLinks }` — `breadcrumbLinks` is gone.

- [ ] **Step 1: Write the failing test**

Add to `apps/web/app/components/shell/__tests__/shellStructure.test.ts`:

```ts
it('renders no breadcrumb anywhere in the shell', async () => {
  const wrapper = await mountSuspended(ContextSidebar, { route: '/projects/7/tasks/99' })
  expect(wrapper.find('[data-testid="project-sidebar-breadcrumb"]').exists()).toBe(false)
  expect(wrapper.find('nav[aria-label]').attributes('aria-label')).not.toBe('مسار الصفحة')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run app/components/shell/__tests__/shellStructure.test.ts`
Expected: FAIL — `project-sidebar-breadcrumb` is present.

- [ ] **Step 3: Write minimal implementation**

In `ContextSidebar.vue`: delete the `workspaceBreadcrumbs` import, the `breadcrumbs` computed, the `breadcrumbLinks` destructure, and the entire `<nav v-if="breadcrumbs.length && expanded" class="nasq-project-breadcrumb" …>…</nav>` block.

In `useShellNavigation.ts`: delete the `breadcrumbLinks` computed, its `projectSidebarLinks` import, and remove `breadcrumbLinks` from the returned object.

Delete the four breadcrumb files, and remove `.nasq-project-breadcrumb` rules from `shell.css`.

Remove the now-unused `nav.breadcrumb`, `nav.breadcrumbCreate`, and `nav.breadcrumbDetails` keys from `apps/web/i18n/locales/ar/common.json` and `apps/web/i18n/locales/en/common.json`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run app/components/shell/__tests__/shellStructure.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A apps/web/app apps/web/i18n
git commit -m "refactor(web): remove the shell breadcrumb the design policy forbids

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 13: Share the create-action builders

**Files:**
- Create: `apps/web/app/composables/nav/createActions.ts`
- Modify: `apps/web/app/components/shell/ContextSidebar.vue`
- Modify: `apps/web/app/components/shell/MobileNavigation.vue`
- Test: `apps/web/app/composables/nav/__tests__/createActions.test.ts`

**Interfaces:**
- Consumes: `safeReturnTo`, `returnToQuery` from `@/utils/safeReturnTo`; `serializeChatListRoute`, `parseChatListRoute` from `@/utils/chatState`; `meetingCreateRoute` from `@/utils/meetingRoutes`.
- Produces:
  - `createListReturnTo(linkId: string, path: string, fullPath: string, query: Record<string, unknown>): string`
  - `createLinkTo(link: { id: string; to: RouteLocationRaw }, route: { path: string; fullPath: string; query: Record<string, unknown>; params: Record<string, unknown> }): RouteLocationRaw`

Move the bodies verbatim from `ContextSidebar.vue` (`listReturnTo` lines 76-100, `createTo` lines 102-115); the two copies are byte-identical, so a single move is safe.

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/composables/nav/__tests__/createActions.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createLinkTo, createListReturnTo } from '../createActions'

describe('createListReturnTo', () => {
  it('returns the current list when already on it', () => {
    expect(createListReturnTo('new-project', '/projects', '/projects?q=a', { q: 'a' })).toBe('/projects?q=a')
  })
  it('falls back to the module list elsewhere', () => {
    expect(createListReturnTo('new-project', '/projects/7/tasks', '/projects/7/tasks', {})).toBe('/projects')
    expect(createListReturnTo('new-employee', '/hr/employees/3', '/hr/employees/3', {})).toBe('/hr')
    expect(createListReturnTo('new-department', '/hr', '/hr', {})).toBe('/hr/departments')
  })
})

describe('createLinkTo', () => {
  it('carries the department into a new document', () => {
    const to = createLinkTo(
      { id: 'new-document', to: '/hr/documents/new' },
      { path: '/hr/departments/4/documents', fullPath: '/hr/departments/4/documents', query: {}, params: { departmentId: '4' } },
    )
    expect(to).toMatchObject({ path: '/hr/documents/new' })
    expect((to as { query: Record<string, string> }).query.department_id).toBe('4')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run app/composables/nav/__tests__/createActions.test.ts`
Expected: FAIL — cannot resolve `../createActions`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/app/composables/nav/createActions.ts` containing the two functions moved verbatim from `ContextSidebar.vue`, with `route.path` / `route.fullPath` / `route.query` / `route.params` replaced by the parameters declared in the Interfaces block above.

In both `ContextSidebar.vue` and `MobileNavigation.vue`: delete the local `listReturnTo` and `createTo` definitions and import the shared pair:

```ts
import { createLinkTo, createListReturnTo } from '@/composables/nav/createActions'

function createTo(link: { id: string; to: import('vue-router').RouteLocationRaw }) {
  return createLinkTo(link, { path: route.path, fullPath: route.fullPath, query: route.query, params: route.params })
}
```

`createListReturnTo` is called from inside `createLinkTo`, so neither component calls it directly.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run app/composables/nav/__tests__/createActions.test.ts`
Expected: PASS, 3 tests.

Verify the duplication is gone:

```bash
grep -c "function listReturnTo" apps/web/app/components/shell/ContextSidebar.vue apps/web/app/components/shell/MobileNavigation.vue
```
Expected: `0` for both.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/composables/nav/createActions.ts apps/web/app/composables/nav/__tests__/createActions.test.ts apps/web/app/components/shell/ContextSidebar.vue apps/web/app/components/shell/MobileNavigation.vue
git commit -m "refactor(web): give the create actions one owning file

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 14: Convert the remaining records to pages

**Files:**
- Modify: every page matched by the sweep below
- Test: `apps/web/app/pages/__tests__/recordPagesBack.test.ts`

**Interfaces:**
- Consumes: `SharedPageHeader` `backTo` / `backLabel` props.
- Produces: every record and form route renders a page-level back link to its owning list.

Sweep for pages that previously relied on overlay presentation:

```bash
grep -rln "returnTo" apps/web/app/pages/meetings apps/web/app/pages/hr apps/web/app/pages/settings apps/web/app/pages/notification-digests
```

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/pages/__tests__/recordPagesBack.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import MeetingDetail from '../meetings/[id].vue'
import EmployeeDetail from '../hr/employees/[employeeId].vue'
import UserDetail from '../settings/users/[userId]/index.vue'
import RoleDetail from '../settings/roles/[roleId]/index.vue'

const cases = [
  ['meeting', MeetingDetail, '/meetings/5', '/meetings'],
  ['employee', EmployeeDetail, '/hr/employees/5', '/hr'],
  ['user', UserDetail, '/settings/users/5', '/settings/users'],
  ['role', RoleDetail, '/settings/roles/5', '/settings/roles'],
] as const

describe('record pages', () => {
  it.each(cases)('%s renders a back link to its list', async (_name, component, route, expected) => {
    const wrapper = await mountSuspended(component, { route })
    const back = wrapper.find('[data-slot="page-header"] a')
    expect(back.attributes('href')).toBe(expected)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run app/pages/__tests__/recordPagesBack.test.ts`
Expected: FAIL — `PageHeader`'s `hideBack` still suppresses some of these, and some pages supply a `returnTo`-derived target.

- [ ] **Step 3: Write minimal implementation**

For each page in the sweep, replace the `safeReturnTo`-derived back target with the list path implied by the route, keeping the current query so filters survive. Example, in `apps/web/app/pages/meetings/[id].vue`:

```ts
const backTo = computed(() => ({ path: '/meetings', query: route.query }))
```

and on its `SharedPageHeader`: `:back-to="backTo" :back-label="$t('nav.meetings')"`.

Owning list per family:

| Route family | Back target |
|---|---|
| `/meetings/:id`, `/meetings/new`, `/meetings/:id/edit` | `/meetings` |
| `/meetings/:id/minutes`, `/meetings/:id/resolutions/**` | `/meetings/:id` |
| `/meetings/series/:id`, `/meetings/series/new` | `/meetings/series` |
| `/hr/employees/**` | `/hr` |
| `/hr/departments/**` | `/hr/departments` |
| `/hr/documents/**`, `/hr/departments/:id/documents/**` | `/hr/documents` |
| `/settings/users/**` | `/settings/users` |
| `/settings/roles/**` | `/settings/roles` |
| `/settings/access-log/:id` | `/settings/access-log` |
| `/notification-digests/:id` | `/notifications` |
| `/project-templates/**` | `/project-templates` |
| `/projects/:id/<section>/**` | `/projects/:id/<section>` |

Delete the `returnTo` reading on these pages only. Do not touch `returnTo` in list pages or in `safeReturnTo.ts` itself — that is out of scope per spec §5.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run app/pages/__tests__/recordPagesBack.test.ts`
Expected: PASS, 4 cases.

- [ ] **Step 5: Commit**

```bash
git add -A apps/web/app/pages
git commit -m "feat(web): give every record page a fixed back target

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 15: One back rule in PageHeader

**Files:**
- Modify: `apps/web/app/components/shared/PageHeader.vue`
- Modify: `apps/web/app/composables/useShellNavigation.ts` (delete `shellRootBackTargets`, `shellSectionRoot`, `projectSectionRoot`, `shellSectionRoots`, `projectRootSections`)
- Test: `apps/web/app/components/shared/__tests__/PageHeader.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `PageHeader` props stay `{ title, description?, eyebrow?, backTo?, backLabel? }`. The back link renders whenever `backTo` or the `back` slot is supplied — no other condition. The `eyebrow` prop is deleted along with its suppression list.

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/components/shared/__tests__/PageHeader.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import PageHeader from '../PageHeader.vue'

describe('PageHeader', () => {
  it('renders the back link whenever backTo is given', async () => {
    const wrapper = await mountSuspended(PageHeader, {
      props: { title: 'مهمة', backTo: '/projects/7/tasks' },
      route: '/projects/7/tasks/99',
    })
    expect(wrapper.find('a[href="/projects/7/tasks"]').exists()).toBe(true)
  })

  it('renders no back link without backTo', async () => {
    const wrapper = await mountSuspended(PageHeader, { props: { title: 'المهام' }, route: '/projects/7/tasks' })
    expect(wrapper.find('[data-slot="page-header"] a').exists()).toBe(false)
  })

  it('accepts no eyebrow prop', () => {
    expect(Object.keys((PageHeader as { props?: Record<string, unknown> }).props ?? {})).not.toContain('eyebrow')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run app/components/shared/__tests__/PageHeader.test.ts`
Expected: FAIL — `hideBack` suppresses the link on a section route and `eyebrow` is still declared.

- [ ] **Step 3: Write minimal implementation**

Replace `apps/web/app/components/shared/PageHeader.vue` entirely:

```vue
<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'

const props = defineProps<{
  title: string
  description?: string
  backTo?: RouteLocationRaw
  backLabel?: string
}>()

usePageHeader(() => props.title, () => props.description)
</script>

<template>
  <header
    data-slot="page-header"
    data-empty="false"
    class="flex flex-wrap items-center justify-between gap-4"
  >
    <div class="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-4">
      <div class="min-w-0">
        <div v-if="props.backTo || $slots.back" class="mb-1 flex items-center gap-2 text-sm">
          <slot name="back">
            <UButton :to="props.backTo!" color="neutral" variant="outline" class="focus-visible:ring-2 focus-visible:ring-ring">
              <UIcon name="i-lucide-arrow-right" aria-hidden="true" class="size-[18px] ltr:rotate-180" />{{ props.backLabel || $t('app.back') }}
            </UButton>
          </slot>
        </div>
        <h2 class="text-lg font-semibold text-highlighted"><slot name="title">{{ props.title }}</slot></h2>
        <p v-if="props.description" class="mt-1 max-w-3xl text-start text-sm leading-6 text-muted">{{ props.description }}</p>
      </div>
      <div v-if="$slots.actions || $slots.default" class="ms-auto flex min-w-0 max-w-full flex-wrap items-center gap-3">
        <slot name="actions"><slot /></slot>
      </div>
    </div>
  </header>
</template>
```

The heading is `<h2>`: the page's single `<h1>` is the project name in the frame, or — outside a project — the shell header's own title binding. Verify with the frame test from Task 5 that exactly one `<h1>` remains per page.

Delete from `useShellNavigation.ts`: `shellSectionRoots`, `shellSectionRoot`, `shellRootBackTargets`, `projectRootSections`, `projectSectionRoot`. Then `grep -rn "shellSectionRoot\|shellRootBackTargets\|projectSectionRoot" apps/web/app` and remove every remaining call.

Remove every `eyebrow` prop passed to `SharedPageHeader` across `apps/web/app/pages` (`grep -rln "eyebrow" apps/web/app`).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run app/components/shared/__tests__/PageHeader.test.ts && npx vitest run app/pages/__tests__/projectWorkspaceFrame.test.ts`
Expected: PASS both.

- [ ] **Step 5: Commit**

```bash
git add -A apps/web/app
git commit -m "refactor(web): reduce the page header to one back rule

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 16: Split useNav and delete dead exports

**Files:**
- Create: `apps/web/app/composables/nav/shellModules.ts`
- Modify: `apps/web/app/composables/useNav.ts` (454 lines → a re-export barrel)
- Modify: `apps/web/app/composables/nav/activeRoute.ts` (gains `activeShellModule`, `contextModuleFor`)
- Modify: `apps/web/app/composables/__tests__/useNav.test.ts`
- Test: `apps/web/app/composables/nav/__tests__/shellModules.test.ts`

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces:
  - `shellModules.ts`: `NavIcon`, `NavGroup`, `ShellModule`, `NavItem`, `useNav`, `shellModules`, `visibleShellModules`, `ShellContextLink`, `contextLinksForModule`, `hidePinnedNewProject`
  - `activeRoute.ts` additionally: `activeShellModule(path: string): ShellModule | null`, `contextModuleFor(module: ShellModule | null): ShellModule | null`
  - `useNav.ts`: `export * from './nav/shellModules'`, `export * from './nav/activeRoute'`, `export * from './nav/projectSections'`

Deleted exports: `shellContextGroups`, `contextGroupsForModule`, `ShellContextGroup`, `projectSidebarLinks`, `projectContextLinks`, `projectWorkspaceLinks`, `projectWorkspaceGroups`, `ProjectWorkspaceModel`, `ProjectWorkspaceGroup`, `ProjectWorkspaceTabLink`, `projectContextId`, `PROJECT_CONTEXT_IDS`, `ProjectContextId`, `PROJECT_WORKSPACE_GROUP_IDS`, `ProjectWorkspaceGroupId`, `PROJECT_WORKSPACE_TAB_IDS`, `ProjectWorkspaceTabId`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/composables/nav/__tests__/shellModules.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import * as nav from '@/composables/useNav'

const removed = [
  'shellContextGroups', 'contextGroupsForModule', 'projectSidebarLinks',
  'projectContextLinks', 'projectWorkspaceLinks', 'projectWorkspaceGroups',
  'projectContextId', 'PROJECT_CONTEXT_IDS', 'PROJECT_WORKSPACE_GROUP_IDS',
]

describe('nav barrel', () => {
  it('no longer exports the superseded project helpers', () => {
    for (const name of removed) expect(nav).not.toHaveProperty(name)
  })

  it('still exports the shell model the sidebar needs', () => {
    for (const name of ['useNav', 'shellModules', 'visibleShellModules', 'contextLinksForModule', 'activeShellModule', 'contextModuleFor', 'hidePinnedNewProject', 'projectSections']) {
      expect(nav).toHaveProperty(name)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run app/composables/nav/__tests__/shellModules.test.ts`
Expected: FAIL — the removed names are still exported.

- [ ] **Step 3: Write minimal implementation**

Move into `apps/web/app/composables/nav/shellModules.ts`, verbatim from `useNav.ts`: the icon constants, `NavIcon`, `NavGroup`, `ShellModule`, `NavItem`, the `items` array, `useNav`, `ShellModuleDefinition`, `shellModules`, `visibleShellModules`, `ShellContextLink`, `hrCreateLinkForPath`, `hidePinnedNewProject`, `projectsContextLinks`, `contextLinksForModule`.

Move `activeShellModule` and `contextModuleFor` into `activeRoute.ts`.

Replace `apps/web/app/composables/useNav.ts` entirely:

```ts
export * from './nav/shellModules'
export * from './nav/activeRoute'
export * from './nav/projectSections'
```

Delete everything else the old file held.

Update `apps/web/app/composables/__tests__/useNav.test.ts`: remove the imports and `describe` blocks covering the deleted functions; keep the capability, module-rail, and context-link coverage.

In `ContextSidebar.vue` and `MobileNavigation.vue`, replace `shellContextGroups(...)` with a direct ordered list:

```ts
const orderedLinks = computed(() => {
  const links = primaryLinks.value
  return [...links.filter(link => link.pinned), ...links.filter(link => !link.pinned)]
})
```

and render `createLinks` / `navigationLinks` from it in place of `contextGroups`. Delete the `nasq-context-group` wrapper and its heading, since there was never more than one group.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npm test`
Expected: PASS across the suite.

- [ ] **Step 5: Commit**

```bash
git add -A apps/web/app
git commit -m "refactor(web): split useNav into three single-purpose modules

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 17: Update DESIGN.md and the component index

**Files:**
- Modify: `DESIGN.md`
- Modify: `docs/design-system/components.md`

**Interfaces:**
- Consumes: nothing.
- Produces: the written policy matches the shipped shell.

- [ ] **Step 1: Rewrite §4's section table**

In `DESIGN.md` §4, replace the group/sub-section table and the sentence «تبويبات المجموعات ثم الفرعية ثم H1 القسم» with:

```markdown
2. صفّ تبويبات واحد مسطّح، والتبويب النشط وحده `aria-current="page"`.

| الترتيب | القسم | المسار |
|---|---|---|
| 1 | الملخص | `/projects/:id` |
| 2 | المهام | `/projects/:id/tasks` |
| 3 | الجدول الزمني | `/projects/:id/schedule` |
| 4 | المعالم | `/projects/:id/milestones` |
| 5 | الحوكمة | `/projects/:id/governance` |
| 6 | المالية | `/projects/:id/finance` |
| 7 | التحديثات | `/projects/:id/updates` |

الحوكمة صفحة فهرس تفتح ملف المشروع وأصحاب المصلحة والمسؤوليات RACI والمخاطر
والمشكلات، ولكلٍّ مسارها وزر رجوع هدفه الفهرس. إعدادات المشروع صفحة مستقلة خارج
الصفّ، يفتحها زر الإعدادات المربع. التبويبات لا تلتف؛ تمرير أفقي.
```

- [ ] **Step 2: Rewrite §5**

Replace the first two paragraphs of §5 with:

```markdown
القوائم والإعدادات والطباعة والصفحات الرئيسية والسجل والإنشاء والتعديل: صفحات
كاملة. لا توجد لوحة جانبية مرتبطة بالمسار في المنتج.

صفحة السجل داخل مساحة المشروع تحتفظ بإطار المشروع فوقها (الاسم ثم صفّ
التبويبات)، ثم سطر رجوع واحد إلى القسم المالك، ثم عنوان السجل، ثم تبويبات السجل
الداخلية عند وجودها. الروابط المباشرة والتحديث والرجوع والفلاتر وحماية المسودة
ملزمة.
```

Keep the existing «الاستثناءات فقط» list of four unchanged, and keep the final line about chat and meeting print.

- [ ] **Step 3: Add the nested strip to §6**

In §6, after the tab-strip bullet, append: `صفّ تبويبات السجل داخل صفحة سجل يستخدم `nasq-ui-tab-strip--nested` بخط أصغر ولون أهدأ ليقرأ كمستوى ثانٍ.`

- [ ] **Step 4: Update the component index**

In `docs/design-system/components.md`, delete the rows for `ProjectRouteHost`, `ProjectRouteModal`, and any breadcrumb entry; update `ProjectWorkspaceTabs` to describe one flat row; add `nav/projectSections.ts`, `nav/activeRoute.ts`, `nav/shellModules.ts`, `nav/createActions.ts`.

- [ ] **Step 5: Commit**

```bash
git add DESIGN.md docs/design-system/components.md
git commit -m "docs: align the design constitution with the shipped navigation

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 18: Update Playwright specs and run every gate

**Files:**
- Modify: `apps/web/e2e/project-clarity.spec.ts`, `project-smooth-navigation.spec.ts`, `project-popups.spec.ts`, `project-entry-regressions.spec.ts`, `nuxt-project-workflows.spec.ts`, `nuxt-project-visual.spec.ts`, `detail.spec.ts`, `board.spec.ts`, `unsaved-changes.spec.ts`
- Create: `apps/web/e2e/navigation-parity.spec.ts`

**Interfaces:**
- Consumes: every earlier task.
- Produces: green gates.

Start the isolated mock stack on free ports per the recorded practice — never touch `:3000`, `:8069`, or the `odoo19` database.

- [ ] **Step 1: Write the failing parity spec**

Create `apps/web/e2e/navigation-parity.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

test('a legacy tab link lands on the section path', async ({ page }) => {
  await page.goto('/projects/1?tab=tasks&q=عقد')
  await expect(page).toHaveURL(/\/projects\/1\/tasks\?q=/)
})

test('closing a task returns to the filtered list', async ({ page }) => {
  await page.goto('/projects/1/tasks?q=عقد')
  await page.getByTestId('task-table').getByRole('link').first().click()
  await expect(page).toHaveURL(/\/projects\/1\/tasks\/\d+/)
  await page.getByRole('link', { name: /المهام/ }).first().click()
  await expect(page).toHaveURL(/\/projects\/1\/tasks\?q=/)
})

test('browser back and the back link agree', async ({ page }) => {
  await page.goto('/projects/1/tasks?q=عقد')
  await page.getByTestId('task-table').getByRole('link').first().click()
  await page.goBack()
  await expect(page).toHaveURL(/\/projects\/1\/tasks\?q=/)
})

test('no sub-tab row exists in a project', async ({ page }) => {
  await page.goto('/projects/1/tasks')
  await expect(page.getByTestId('project-workspace-subtabs')).toHaveCount(0)
  await expect(page.getByTestId('project-workspace-tabs')).toHaveCount(1)
})

test('the tab strip scrolls rather than wraps on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/projects/1/tasks')
  const strip = page.getByTestId('project-workspace-tabs')
  await expect(strip).toBeVisible()
  const box = await strip.boundingBox()
  expect(box!.height).toBeLessThan(64)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/web && npm run test:e2e -- navigation-parity.spec.ts`
Expected: FAIL before the existing specs are updated, because selectors still assume the old structure.

- [ ] **Step 3: Update the existing specs**

In each modified spec: replace `?tab=tasks` / `?tab=milestones` / `?tab=summary` URLs with the section paths; replace `project-subtab-*` selectors with `project-tab-*`; replace assertions on the sheet (`project-route-modal`, dimmed background, `fullPage=1`) with assertions on the record page and its back link.

- [ ] **Step 4: Run every gate**

```bash
cd apps/web && npm run test:e2e
```
Expected: PASS.

```bash
npm test
```
Expected: PASS.

```bash
npx -w apps/web vue-tsc --noEmit
```
Expected: no errors.

```bash
python3 -B tools/ui_policy.py
```
Expected: clean.

```bash
grep -rn "?tab=\|projectOverlayRoute\|workspaceBreadcrumbs\|shellContextGroups" apps/web/app apps/web/e2e
```
Expected: no matches.

- [ ] **Step 5: Commit**

```bash
git add -A apps/web/e2e
git commit -m "test(web): cover the flattened navigation and legacy link parity

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-Review Notes

**Spec coverage:** §1 → Tasks 1, 2, 4, 5, 6, 7, 8, 9. §1 redirects → Task 3. §2 → Tasks 10, 11, 14. §3 → Tasks 12, 15. §4 → Tasks 13, 16. §5 scope limit → honoured in Task 14 ("do not touch `returnTo` in list pages"). §6 → Task 17. §7 → Task 18.

**Known ordering constraint:** Task 5 leaves a transient heading-level mismatch that Task 15 resolves. Run them in the same working session; do not ship Task 5 without Task 15.

**Residual risk:** Task 14's sweep covers four families by test but edits more pages than it asserts. The Task 18 `grep` gate is the backstop that proves nothing still reads the removed helpers.
