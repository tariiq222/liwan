import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { createMemoryHistory, createRouter, type RouteLocationRaw, type Router } from 'vue-router'
import { describe, expect, it } from 'vitest'

const webRoot = resolve(import.meta.dirname, '../../../')

// Each record page is evaluated as its real <script setup> against a real
// vue-router, so the back target is proven by resolving it, not read off source.
function loadSetupState(rel: string, router: Router) {
  const file = resolve(webRoot, rel)
  const descriptor = parse(readFileSync(file, 'utf8'), { filename: file }).descriptor
  const compiled = compileScript(descriptor, { id: 'record-back-targets', inlineTemplate: false }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '')
    .replace('export default', 'return')
  const js = ts.transpileModule(compiled, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  }).outputText
  const emptyQuery = () => ({ data: Vue.ref(undefined), isLoading: Vue.ref(false), isFetching: Vue.ref(false), isPending: Vue.ref(false), error: Vue.ref(null), refetch: () => undefined, mutateAsync: async () => ({}), mutate: () => undefined, fetchNextPage: () => undefined, hasNextPage: Vue.ref(false), isFetchingNextPage: Vue.ref(false), isFetchNextPageError: Vue.ref(false), isError: Vue.ref(false) })
  const bindings: Record<string, unknown> = {
    _defineComponent: Vue.defineComponent,
    computed: Vue.computed, ref: Vue.ref, watch: Vue.watch, shallowRef: Vue.shallowRef, reactive: Vue.reactive,
    inject: () => false, nextTick: Vue.nextTick,
    onMounted: () => undefined, onBeforeUnmount: () => undefined,
    useRoute: () => router.currentRoute.value, useRouter: () => router,
    useI18n: () => ({ t: (k: string) => k, locale: Vue.ref('ar'), localeProperties: Vue.ref({ dir: 'rtl' }) }),
    useHydrated: () => Vue.ref(true),
    useAccess: () => ({ can: () => true }),
    useToast: () => ({ add: () => undefined }),
    useSsrQuerySeed: () => undefined,
    usePageHeader: () => undefined,
    navigateTo: () => Promise.resolve(),
    defineOptions: () => undefined,
    ApiError: class ApiError extends Error { status = 0 },
    useMeeting: emptyQuery, useCreateResolution: emptyQuery, usePatchMeeting: emptyQuery,
    useHrEmployee: emptyQuery, useHrEmployees: emptyQuery, useHrDepartments: emptyQuery,
    useProject: emptyQuery, useProjectRegisterItem: emptyQuery, useProjectStakeholders: emptyQuery,
    useDeleteProjectStakeholder: emptyQuery, useNotificationDigest: emptyQuery,
    governanceFilters: () => ({ q: '', offset: 0 }),
    createMeetingMinutesForm: () => ({}),
  }
  // Imported child components were stripped with the imports but are still
  // named in the returned binding object. Supply a stub for each name the
  // evaluation actually asks for rather than listing them by hand.
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const component = new Function(...Object.keys(bindings), js)(...Object.values(bindings))
      return component.setup!({}, { expose: () => {}, attrs: {}, slots: {}, emit: () => {} }) as Record<string, unknown>
    }
    catch (error) {
      const missing = error instanceof ReferenceError ? /(\w+) is not defined/.exec(error.message)?.[1] : undefined
      if (!missing || missing in bindings) throw error
      bindings[missing] = {}
    }
  }
  throw new Error(`${rel}: too many undefined bindings`)
}

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/meetings', component: { template: '<div/>' } },
      { path: '/meetings/:id/edit', component: { template: '<div/>' } },
      { path: '/meetings/:id/resolutions/new', component: { template: '<div/>' } },
      { path: '/hr/employees/:employeeId/edit', component: { template: '<div/>' } },
      { path: '/hr/departments/:departmentId/documents/new', component: { template: '<div/>' } },
      { path: '/projects/:id/register/:registerId', component: { template: '<div/>' } },
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

// url -> [page, expected back path], each carrying a hostile referrer and a filter.
const CASES: [string, string, string, string][] = [
  ['a meeting resolution form', '/meetings/7/resolutions/new?returnTo=%2Fprojects%2F9&q=%D8%B9%D9%82%D8%AF', 'app/pages/meetings/[id]/resolutions/new.vue', '/meetings/7'],
  ['a meeting edit form', '/meetings/7/edit?returnTo=%2Fprojects%2F9&q=%D8%B9%D9%82%D8%AF', 'app/pages/meetings/[id]/edit.vue', '/meetings'],
  ['an employee edit form', '/hr/employees/12/edit?returnTo=%2Fsettings%2Fusers&q=%D8%B9%D9%82%D8%AF', 'app/pages/hr/employees/[employeeId]/edit.vue', '/hr'],
  ['a department document form', '/hr/departments/4/documents/new?returnTo=%2Fhr&q=%D8%B9%D9%82%D8%AF', 'app/pages/hr/departments/[departmentId]/documents/new.vue', '/hr/documents'],
  ['a project register record', '/projects/7/register/3?returnTo=%2Fprojects&q=%D8%B9%D9%82%D8%AF', 'app/pages/projects/[id]/register/[registerId].vue', '/projects/7/register'],
  ['a notification digest', '/notification-digests/5?returnTo=%2Ftasks&q=%D8%B9%D9%82%D8%AF', 'app/pages/notification-digests/[id].vue', '/notifications'],
]

describe('every record and form page returns to the list its own route implies', () => {
  for (const [label, url, page, expected] of CASES) {
    it(`sends ${label} to ${expected}, keeping its filters`, async () => {
      const back = await backTargetOf(url, page)
      expect(back.path, page).toBe(expected)
      // The filter the list was showing survives the round trip…
      expect(back.query.q, page).toBe('عقد')
      // …and the referrer on the URL cannot redirect the back control, nor ride
      // onto the list URL where it would nest one level deeper each round trip.
      expect(back.query.returnTo, page).toBeUndefined()
    })
  }

  it('sends a governance child back to the governance card list, not the project', async () => {
    // The four governance pages have no tab of their own; the card list is the
    // only way back, and it is fixed by the project in the path.
    const back = await backTargetOf('/projects/7/stakeholders?q=%D8%B9%D9%82%D8%AF', 'app/pages/projects/[id]/stakeholders/index.vue')
    expect(back.path).toBe('/projects/7/governance')
  })
})
