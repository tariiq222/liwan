import { projectRecordBack } from '../../utils/projectNavigation'
import * as recordNavigation from './helpers/recordNavigation'
import * as hrNavigation from '../../utils/hrReturnTo'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import * as Vue from 'vue'
import ts from 'typescript'
import { createMemoryHistory, createRouter, type RouteLocationRaw } from 'vue-router'
import { describe, expect, it, vi } from 'vitest'
import { safeReturnTo } from '@webvue/ui/app/utils/safeReturnTo'
import { activeProjectSection, activeGovernanceSection, projectIdFromPath } from '../../modules/pmo/projectRoutes'

const projectTasks = 'projects/[id]/tasks.vue'
const document = { id: 9, name: 'Title', body: '<p>Body</p>', attachment_ids: [] }

async function loadPage(page: string, url: RouteLocationRaw, overrides: Record<string, unknown> = {}) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: {} }] })
  await router.push(url)
  const route = { ...router.currentRoute.value, params: { departmentId: '3', documentId: '9' } }
  const filename = resolve(import.meta.dirname, '..', page)
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
  const script = compileScript(descriptor, { id: 'ui-review' }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '')
    .replace('export default', 'return')
  const transpile = (source: string) => ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  }).outputText
  const update = vi.fn(async ({ patch }: { patch: { name: string, body: string } }) => ({ ...document, ...patch }))
  const navigate = vi.fn(async () => undefined)
  const escapeTargets: unknown[] = []
  const bindings: Record<string, unknown> = {
    ...hrNavigation, ...recordNavigation,
    useRecordListPaths: () => Vue.ref(['/projects', '/projects/dashboard', '/tasks', '/hr', '/settings/users', '/account', '/search', '/notifications']),
    refDebounced: (value: unknown) => value, searchProviders: () => [], visibleCommands: () => [],
    _defineComponent: Vue.defineComponent, defineComponent: Vue.defineComponent,
    computed: Vue.computed, ref: Vue.ref, watch: Vue.watch,
    onMounted: () => undefined, useEventListener: () => undefined,
    useRoute: () => route, useRouter: () => router,
    useI18n: () => ({ t: (key: string) => key }),
    useAccess: () => ({ can: () => true }), useHydrated: () => Vue.ref(true),
    useToast: () => ({ add: vi.fn() }), usePageHeader: () => undefined,
    projectRecordBack, safeReturnTo, projectIdFromPath, activeProjectSection, activeGovernanceSection,
    provideFrameOwnsHeading: () => undefined,
    useEscapeBack: (target: unknown) => { escapeTargets.push(target) },
    projectTaskParams: () => ({}), projectTaskQuery: () => ({}),
    useProject: () => ({ data: Vue.ref({ active: true, name: 'Example project', can_manage: true, status: 'active', phase_state: { current: 'initiating' } }), error: Vue.ref(null) }),
    useArchivedTasks: () => ({ data: Vue.ref({ pages: [] }), isLoading: Vue.ref(false) }),
    useRestoreTask: () => ({ mutate: vi.fn(), isPending: Vue.ref(false) }),
    useMe: () => ({ me: Vue.ref({}) }), useProjectWorkspaceMemory: () => ({ remember: () => undefined }), useApi: () => ({ $api: vi.fn() }),
    firstAllowedPath: () => '/projects', useNav: () => [],
    useQuery: () => ({ data: Vue.ref([{ id: 7, name: 'Example' }]), isLoading: Vue.ref(false), error: Vue.ref(null) }),
    ProjectRefSchema: { array: () => ({}) }, findSearchShortcut: () => undefined,
    // search.vue reads its sections from the manifest-driven composable; one PMO projects section.
    manifestRoutePrefixes: () => ['/projects', '/tasks', '/hr'],
    useAppSearch: () => [{
      provider: { id: 'pmo-projects', labelKey: 'nav.projects', icon: 'i-lucide-folder' },
      rows: Vue.ref([{ id: 7, label: 'Example', to: '/projects/7' }]), visible: Vue.ref(true),
      loading: Vue.ref(false), waiting: Vue.ref(false), hasNext: Vue.ref(false), fetchingNext: Vue.ref(false), truncated: Vue.ref(false), error: Vue.ref(null), refetch: () => undefined,
    }],
    useUpdateDocument: () => ({ mutateAsync: update, isPending: Vue.ref(false) }),
    useSsrQuerySeed: () => undefined, navigateTo: navigate,
    ApiError: class ApiError extends Error {},
    TaskBoard: {}, TaskTable: {}, TaskToolbar: {}, TaskKpiStrip: {}, FilterBar: {}, DocumentEditor: {},
    projectStatusBadge: () => ({ tone: 'neutral', labelKey: '' }), badgeLabel: () => '', ProjectWorkspaceTabs: {}, ProjectPhaseStepper: {},
    ...overrides,
  }
  const component = new Function(...Object.keys(bindings), transpile(script))(...Object.values(bindings))
  const scope = Vue.effectScope()
  const state = scope.run(() => component.setup({}, { expose: () => {}, attrs: {}, slots: {}, emit: () => {} }))
  const template = compileTemplate({ source: descriptor.template!.content, filename, id: 'ui-review', compilerOptions: { mode: 'function', expressionPlugins: ['typescript'] } })
  const render = new Function('Vue', transpile(template.code))(Vue)
  let html = ''
  async function rendered() {
    const captured: { name: string, props: Record<string, unknown> }[] = []
    const app = Vue.createSSRApp(Vue.defineComponent({ setup: () => Object.fromEntries(Object.entries(state).filter(([key]) => !key.startsWith('$'))), render }))
    for (const name of new Set([...descriptor.template!.content.matchAll(/<([A-Z]\w*)/g)].map(match => match[1]!))) {
      app.component(name, Vue.defineComponent({ inheritAttrs: false, setup(_, { attrs, slots }) {
        return () => { captured.push({ name, props: { ...attrs } }); return Vue.h('div', [slots.default?.(), slots.header?.(), slots.view?.()]) }
      } }))
    }
    html = await renderToString(app)
    return captured
  }
  return { state, route, router, update, navigate, rendered, escapeTargets, get html() { return html }, stop: () => scope.stop() }
}

async function propsFor(page: Awaited<ReturnType<typeof loadPage>>, name: string, predicate = (_props: Record<string, unknown>) => true) {
  return (await page.rendered()).find(node => node.name === name && predicate(node.props))?.props
}

describe('reviewed page navigation and form feedback', () => {
  it('round-trips the project board, filters and hash through the archive link', async () => {
    const origin = '/projects/7/tasks?view=board&q=abc#board'
    const list = await loadPage(projectTasks, origin)
    const link = await propsFor(list, 'NuxtLink')
    const archive = await loadPage('../components/pmo/tasks/TaskArchivedList.vue', link!.to as RouteLocationRaw)
    expect(archive.route.query.project_id).toBe('7')
    expect((await propsFor(archive, 'SharedListPage'))!['back-to']).toBe(origin)
    list.stop(); archive.stop()
  })

  it.each([undefined, 'https://evil.example', '//evil.example', '/settings/users'])('uses the project task fallback for an absent or unsafe archive return target %s', async returnTo => {
    const page = await loadPage('../components/pmo/tasks/TaskArchivedList.vue', { path: '/tasks', query: { scope: 'archived', project_id: '7', returnTo } })
    expect((await propsFor(page, 'SharedListPage'))!['back-to']).toBe('/projects/7/tasks')
    page.stop()
  })

  it('carries the full search URL into a project result and its safe Back target', async () => {
    const origin = '/search?q=Example#results'
    const page = await loadPage('search.vue', origin)
    const link = await propsFor(page, 'NuxtLink')
    const target = page.router.resolve(link!.to as RouteLocationRaw)
    expect(target.path).toBe('/projects/7')
    const frame = await loadPage('projects/[id].vue', target.fullPath)
    const back = await propsFor(frame, 'UButton', props => props['data-testid'] === 'project-workspace-back')
    expect(back?.to).toBe(origin)
    expect(Vue.toValue(frame.escapeTargets[0] as Vue.ComputedRef<string>)).toBe(origin)
    page.stop(); frame.stop()
  })

  it.each([undefined, 'https://evil.example', '//evil.example', '/unexpected'])('gives the summary a safe Back fallback for %s', async returnTo => {
    const page = await loadPage('projects/[id].vue', { path: '/projects/7/', query: { returnTo } })
    const back = await propsFor(page, 'UButton', props => props['data-testid'] === 'project-workspace-back')
    // The frame's Back is the nearest step of the trail under the project name (DESIGN.md §3).
    expect(back).toMatchObject({ to: '/projects', color: 'neutral', variant: 'link' })
    const nodes = await page.rendered()
    expect(nodes.filter(node => node.name === 'ProjectWorkspaceTabs')).toHaveLength(1)
    expect(nodes.find(node => node.props['data-testid'] === 'project-workspace-settings')?.props.to).toBe('/projects/7/settings')
    expect(page.html.match(/<h1\b/g)).toHaveLength(1)
    expect(page.html).toContain('Example project')
    page.stop()
  })

  it.each([
    ['/projects?q=active', 'nav.projects'], ['/tasks?view=board', 'nav.tasks'],
    ['/hr?q=name', 'nav.hr'], ['/settings/users', 'nav.settings'],
    ['/account', 'nav.account'], ['/search?q=Example#results', 'app.search'],
    ['/notifications', 'notifications.title'],
  ])('names the summary Back destination for %s', async (returnTo, label) => {
    const page = await loadPage('projects/[id].vue', { path: '/projects/7', query: { returnTo } })
    const back = await propsFor(page, 'UButton', props => props['data-testid'] === 'project-workspace-back')
    expect(back).toMatchObject({ to: returnTo, 'aria-label': label })
    page.stop()
  })

  it.each(['/projects/7/tasks/9', '/projects/7/milestones/9/edit', '/projects/7/settings', '/projects/7/tasks'])('does not add a competing frame Back control on %s', async path => {
    const page = await loadPage('projects/[id].vue', { path, query: { returnTo: '/search?q=Example' } })
    expect(await propsFor(page, 'UButton', props => props['data-testid'] === 'project-workspace-back')).toBeUndefined()
    expect(Vue.toValue(page.escapeTargets[0] as Vue.ComputedRef<string>)).toBeUndefined()
    expect(page.html.match(/<h1\b/g)).toHaveLength(1)
    page.stop()
  })

  it('keeps the empty-error frame hidden', async () => {
    const page = await loadPage('projects/[id].vue', '/projects/7', {
      useProject: () => ({ data: Vue.ref(undefined), error: Vue.ref(new Error('offline')), isLoading: Vue.ref(false) }),
    })
    expect(await propsFor(page, 'SharedPageContainer')).toBeUndefined()
    expect(Vue.toValue(page.escapeTargets[0] as Vue.ComputedRef<string>)).toBeUndefined()
    page.stop()
  })

})
