import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { createMemoryHistory, createRouter, type RouteLocationRaw, type Router } from 'vue-router'
import { describe, expect, it } from 'vitest'
import { adminListQuery, adminPathWithQuery } from '../../composables/adminSettingsPaths'
import { parsePositiveId } from '../../utils/routeParams'

const webRoot = resolve(import.meta.dirname, '../../../')

const emptyQuery = () => ({
  data: Vue.ref(undefined), isLoading: Vue.ref(false), isFetching: Vue.ref(false), isPending: Vue.ref(false),
  error: Vue.ref(null), refetch: () => undefined, mutateAsync: async () => ({}), mutate: () => undefined,
  fetchNextPage: () => undefined, hasNextPage: Vue.ref(false), isFetchingNextPage: Vue.ref(false),
  isFetchNextPageError: Vue.ref(false), isError: Vue.ref(false), items: Vue.ref([]),
})

// The template pages get their target from a composable rather than inline, so
// the real composable source is evaluated too — stubbing it would test the stub.
function loadTemplateNavigation(router: Router) {
  const source = readFileSync(resolve(webRoot, 'app/composables/useProjectTemplates.ts'), 'utf8')
  const start = source.indexOf('export function useProjectTemplateNavigation()')
  const end = source.indexOf('\n}', start) + 2
  const js = ts.transpileModule(source.slice(start, end).replace('export function', 'return function'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  }).outputText
  const factory = new Function('computed', 'useRoute', js)(Vue.computed, () => router.currentRoute.value)
  return factory()
}

// Each page is evaluated as its real <script setup> against a real vue-router,
// so the back target is proven by resolving it, not read off the source.
function loadSetupState(rel: string, router: Router) {
  const file = resolve(webRoot, rel)
  const descriptor = parse(readFileSync(file, 'utf8'), { filename: file }).descriptor
  const compiled = compileScript(descriptor, { id: 'record-back-targets', inlineTemplate: false }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '')
    .replace('export default', 'return')
  const js = ts.transpileModule(compiled, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  }).outputText
  const bindings: Record<string, unknown> = {
    _defineComponent: Vue.defineComponent,
    computed: Vue.computed, ref: Vue.ref, watch: Vue.watch, shallowRef: Vue.shallowRef, reactive: Vue.reactive,
    inject: () => false, nextTick: Vue.nextTick,
    onMounted: () => undefined, onBeforeUnmount: () => undefined,
    useRoute: () => router.currentRoute.value, useRouter: () => router,
    useI18n: () => ({ t: (k: string) => k, locale: Vue.ref('ar'), localeProperties: Vue.ref({ dir: 'rtl' }) }),
    useHydrated: () => Vue.ref(true),
    useAccess: () => ({ can: () => true }),
    useMe: () => ({ me: Vue.ref({ capabilities: [] }) }),
    useToast: () => ({ add: () => undefined }),
    useSsrQuerySeed: () => undefined,
    usePageHeader: () => undefined,
    navigateTo: () => Promise.resolve(),
    defineOptions: () => undefined,
    ApiError: class ApiError extends Error { status = 0 },
    // Real helpers, not stubs: these decide the ids the target is built from.
    parsePositiveId, adminListQuery, adminPathWithQuery,
    useProjectTemplateNavigation: () => loadTemplateNavigation(router),
    financeWriteAllowed: () => true,
    shouldKeepFinanceFormMounted: () => false,
    governanceFilters: () => ({ q: '', offset: 0 }),
    createMeetingMinutesForm: () => ({}),
  }
  // Imported child components and data composables were stripped with the
  // imports but are still named in the compiled output. Supply a stub for each
  // name the evaluation actually asks for rather than listing them by hand;
  // none of them feeds the back target, which comes from the router alone.
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const component = new Function(...Object.keys(bindings), js)(...Object.values(bindings))
      return component.setup!({}, { expose: () => {}, attrs: {}, slots: {}, emit: () => {} }) as Record<string, unknown>
    }
    catch (error) {
      const message = error instanceof Error ? error.message : ''
      const undefinedName = error instanceof ReferenceError ? /(\w+) is not defined/.exec(message)?.[1] : undefined
      if (undefinedName && !(undefinedName in bindings)) { bindings[undefinedName] = {}; continue }
      const notCallable = error instanceof TypeError ? /(\w+) is not a function/.exec(message)?.[1] : undefined
      if (notCallable && typeof bindings[notCallable] !== 'function') { bindings[notCallable] = emptyQuery; continue }
      throw error
    }
  }
  throw new Error(`${rel}: too many undefined bindings`)
}

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/meetings', component: { template: '<div/>' } },
      { path: '/meetings/new', component: { template: '<div/>' } },
      { path: '/meetings/:id/edit', component: { template: '<div/>' } },
      { path: '/meetings/:id/resolutions/new', component: { template: '<div/>' } },
      { path: '/meetings/series/:id/edit', component: { template: '<div/>' } },
      { path: '/hr/employees/:employeeId/edit', component: { template: '<div/>' } },
      { path: '/hr/departments/:departmentId/documents/new', component: { template: '<div/>' } },
      { path: '/hr/departments/:departmentId/documents/:documentId/edit', component: { template: '<div/>' } },
      { path: '/hr/departments/:departmentId/edit', component: { template: '<div/>' } },
      { path: '/settings/roles/:roleId/edit', component: { template: '<div/>' } },
      { path: '/project-templates/:id/edit', component: { template: '<div/>' } },
      { path: '/projects/:id/register/new', component: { template: '<div/>' } },
      { path: '/projects/:id/register/:registerId', component: { template: '<div/>' } },
      { path: '/projects/:id/register/:registerId/edit', component: { template: '<div/>' } },
      { path: '/projects/:id/finance/:entryId/edit', component: { template: '<div/>' } },
      { path: '/projects/:id/milestones/:milestoneId/edit', component: { template: '<div/>' } },
      { path: '/projects/:id/stakeholders', component: { template: '<div/>' } },
      { path: '/notification-digests/:id', component: { template: '<div/>' } },
      { path: '/:rest(.*)', component: { template: '<div/>' } },
    ],
  })
}

async function backTargetOf(url: string, page: string) {
  const router = makeRouter()
  await router.push(url)
  await router.isReady()
  const state = loadSetupState(page, router)
  return router.resolve(Vue.unref(state.backTo as Vue.Ref<RouteLocationRaw>))
}

// Every URL carries a hostile referrer and the filter q=عقد, so each case also
// proves the referrer cannot redirect the control and the filter survives.
const REFERRER = 'returnTo=%2Fsettings%2Fusers'
const FILTER = 'q=%D8%B9%D9%82%D8%AF'
const withState = (path: string) => `${path}?${REFERRER}&${FILTER}`

// [what it is, url, page, expected back path]
const CREATES: [string, string, string][] = [
  [withState('/meetings/new'), 'app/pages/meetings/new.vue', '/meetings'],
  [withState('/meetings/7/resolutions/new'), 'app/pages/meetings/[id]/resolutions/new.vue', '/meetings/7'],
  [withState('/hr/departments/4/documents/new'), 'app/pages/hr/departments/[departmentId]/documents/new.vue', '/hr/documents'],
  [withState('/projects/7/register/new'), 'app/pages/projects/[id]/register/new.vue', '/projects/7/register'],
]

const EDITS: [string, string, string][] = [
  [withState('/meetings/7/edit'), 'app/pages/meetings/[id]/edit.vue', '/meetings/7'],
  [withState('/meetings/series/12/edit'), 'app/pages/meetings/series/[id]/edit.vue', '/meetings/series/12'],
  [withState('/hr/employees/12/edit'), 'app/pages/hr/employees/[employeeId]/edit.vue', '/hr/employees/12'],
  [withState('/hr/departments/4/edit'), 'app/pages/hr/departments/[departmentId]/edit.vue', '/hr/departments/4'],
  [withState('/hr/departments/4/documents/9/edit'), 'app/pages/hr/departments/[departmentId]/documents/[documentId]/edit.vue', '/hr/departments/4/documents/9'],
  [withState('/settings/roles/6/edit'), 'app/pages/settings/roles/[roleId]/edit.vue', '/settings/roles/6'],
  [withState('/project-templates/4/edit'), 'app/pages/project-templates/[id]/edit.vue', '/project-templates/4'],
  [withState('/projects/7/register/3/edit'), 'app/pages/projects/[id]/register/[registerId]/edit.vue', '/projects/7/register/3'],
  [withState('/projects/7/finance/5/edit'), 'app/pages/projects/[id]/finance/[entryId]/edit.vue', '/projects/7/finance/5'],
]

const RECORDS: [string, string, string][] = [
  [withState('/hr/employees/12'), 'app/pages/hr/employees/[employeeId].vue', '/hr'],
  [withState('/projects/7/register/3'), 'app/pages/projects/[id]/register/[registerId].vue', '/projects/7/register'],
  [withState('/notification-digests/5'), 'app/pages/notification-digests/[id].vue', '/notifications'],
]

function expectTarget(label: string, cases: [string, string, string][]) {
  for (const [url, page, expected] of cases) {
    it(`${label}: ${url.split('?')[0]} to ${expected}`, async () => {
      const back = await backTargetOf(url, page)
      expect(back.path, page).toBe(expected)
      expect(back.query.q, `${page}: the filter the list was showing must survive`).toBe('عقد')
      expect(back.query.returnTo, `${page}: a referrer must not ride onto the destination`).toBeUndefined()
    })
  }
}

describe('a create form returns to the list it adds to', () => {
  expectTarget('create', CREATES)
})

describe('an edit form returns to the record it edits, not past it to the list', () => {
  expectTarget('edit', EDITS)

  it('falls back to the section list only where the sub-record has no page of its own', async () => {
    // There is no /projects/:id/milestones/:milestoneId page to return to, so
    // the milestone editor is the one edit form that may land on its list.
    const back = await backTargetOf(withState('/projects/7/milestones/8/edit'), 'app/pages/projects/[id]/milestones/[milestoneId]/edit.vue')
    expect(back.path).toBe('/projects/7/milestones')
    expect(back.query.q).toBe('عقد')
  })
})

describe('a record returns to the list it belongs to', () => {
  expectTarget('record', RECORDS)

  it('gives the governance sub-sections no back line: they are tabs, not records', () => {
    for (const page of ['charter.vue', 'raci.vue', 'stakeholders.vue', 'register.vue']) {
      const source = readFileSync(resolve(webRoot, `app/pages/projects/[id]/${page}`), 'utf8')
      expect(source, page).not.toContain('back-to=')
    }
  })
})
