import { meetingViewRoute, meetingViewOptions } from '../../utils/meetingRoutes'
import { readFileSync } from 'node:fs'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { createMemoryHistory, createRouter, onBeforeRouteLeave, onBeforeRouteUpdate, RouterLink, RouterView, useRoute, useRouter, type RouteLocationNormalized } from 'vue-router'
import { refDebounced } from '@vueuse/core'
import { createHooks } from 'hookable'
import { useMeetingListQuerySync } from '../../composables/useMeetingListQuerySync'
import { expect, it } from 'vitest'
import * as filters from '../../utils/meetingListFilters'
import { parseOffset } from '../../utils/routeQuery'
import { returnToQuery } from '@webvue/ui/app/utils/safeReturnTo'
import { rootedNode } from '../../../tests/hostNode'

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

function gate() {
  let release!: () => void
  let enter!: () => void
  const started = new Promise<void>(resolve => { enter = resolve })
  const pending = new Promise<void>(resolve => { release = resolve })
  return { release, started, hold: () => { enter(); return pending } }
}

async function mountList(file: 'index.vue' | 'series.vue', base: string, auth: (to: RouteLocationNormalized) => unknown | Promise<unknown>, deferPageRoute = false, initial = `${base}#agenda`, renderedLink?: 'desktop' | 'mobile') {
  const permission = Vue.ref(true)
  const hooks = createHooks<{ 'webvue:navigation:start': (to: RouteLocationNormalized) => void }>()
  const pageRoute = Vue.shallowRef<any>(null)
  const deferredRoute = new Proxy({}, { get: (_target, key) => pageRoute.value?.[key] })
  const filename = new URL(`../meetings/${file}`, import.meta.url).pathname
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
  const script = compileScript(descriptor, { id: 'meeting-list-departure' }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
  const bindings = { meetingViewRoute, meetingViewOptions,
    ...filters, parseOffset, _defineComponent: Vue.defineComponent, defineComponent: Vue.defineComponent,
    ref: Vue.ref, computed: Vue.computed, reactive: Vue.reactive, watch: Vue.watch, onScopeDispose: Vue.onScopeDispose,
    useRoute: deferPageRoute ? () => deferredRoute : useRoute, useRouter, onBeforeRouteLeave, onBeforeRouteUpdate, refDebounced, returnToQuery,
    useMeetingListQuerySync, useNuxtApp: () => ({ hook: hooks.hook.bind(hooks) }),
    useI18n: () => ({ t: (key: string) => key, locale: Vue.ref('ar') }), useHydrated: () => Vue.ref(true), useKpiVisibility: () => ({ shown: Vue.ref(true) }),
    useAccess: () => ({ can: () => permission.value }), useRecordPickerAvailable: () => Vue.computed(() => permission.value),
    usePeople: () => ({ data: Vue.ref([]), isLoading: Vue.ref(false), error: Vue.ref(null) }),
    useMeetings: () => ({ data: Vue.ref({ items: [], total: 120 }), isLoading: Vue.ref(false), isFetching: Vue.ref(false), error: Vue.ref(null) }),
    useMeetingListKpis: () => ({ tiles: Vue.ref([]), loading: Vue.ref(false) }), useMeetingSeriesKpis: () => ({ tiles: Vue.ref([]), loading: Vue.ref(false) }),
    useMeetingSeriesList: () => ({ data: Vue.ref({ items: [], total: 120 }), isLoading: Vue.ref(false), isFetching: Vue.ref(false), error: Vue.ref(null) }),
    formatCalendarDate: () => '', formatWebVueTime: () => '', formatLocalDateTime: () => '', meetingStateBadgeProps: () => ({}),
    FilterBar: {}, RecordNumber: {}, MeetingProjectFilter: {},
  }
  const code = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText
  const page = new Function(...Object.keys(bindings), code)(...Object.values(bindings))
  let state: any
  let linkRender: any
  if (renderedLink) {
    // Compile the actual owned link attributes so a click/capture regression
    // exercises RouterLink's merged listener order, not a manually called handler.
    const links = [...descriptor.template!.content.matchAll(/<NuxtLink\b[\s\S]*?<\/NuxtLink>/g)]
    const link = links[renderedLink === 'desktop' ? 0 : 1]![0]
    const fragment = link.slice(0, link.indexOf('>') + 1) + 'record</NuxtLink>'
    const template = compileTemplate({ source: fragment, filename, id: 'meeting-real-link', compilerOptions: { mode: 'function' } })
    if (template.errors.length) throw template.errors[0]
    linkRender = new Function('Vue', template.code)(Vue)
  }
  const LinkProbe = Vue.defineComponent({ setup: () => ({ ...state, row: { id: 9, original: { id: 9 } }, series: { id: 9 } }), render: linkRender })
  const ListPage = Vue.defineComponent({ setup(props, ctx) {
    state = page.setup(props, { ...ctx, expose: () => {} })
    return () => Vue.h('div', [renderedLink ? Vue.h(LinkProbe) : null, Vue.h(RouterView)])
  } })
  const Blank = Vue.defineComponent({ render: () => Vue.h('div') })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: base, component: ListPage, children: [{ path: ':recordId', component: Blank }] }, { path: '/outside', component: Blank }] })
  const anchors: any[] = []
  const node = (tag = '') => rootedNode({ tag, props: {} as Record<string, any>, children: [] as any[], parent: null as any })
  const renderer = Vue.createRenderer<any, any>({
    patchProp(element, key, _previous, next) { element.props[key] = next }, insert(child, parent) { child.parent = parent; parent.children.push(child) }, remove() {},
    createElement: tag => { const element = node(tag); if (tag === 'a') anchors.push(element); return element }, createText: node, createComment: node, setText() {}, setElementText() {},
    parentNode: n => n.parent, nextSibling: () => null,
  })
  await router.push(initial)
  pageRoute.value = router.currentRoute.value
  const app = renderer.createApp({ render: () => Vue.h(RouterView) })
  app.use(router); app.component('NuxtLink', RouterLink); app.mount(node()); await Vue.nextTick()
  const started: RouteLocationNormalized[] = []
  router.beforeEach(async to => {
    // The public auth middleware contract: publish the real target before its first identity await.
    started.push(to)
    await hooks.callHook('webvue:navigation:start', to)
    return await auth(to) as any
  })
  const createExpression = parse(readFileSync(filename, 'utf8')).descriptor.template!.content.match(/:create-to="([^"]+)"/)![1]!
  const createTo = () => {
    const scope = { ...bindings, ...Object.fromEntries(Object.entries(state).map(([key, value]) => [key, Vue.unref(value)])) }
    return new Function(...Object.keys(scope), `return (${createExpression})`)(...Object.values(scope))
  }
  return { router, get state() { return state }, started, permission, anchors, createTo, syncPageRoute: () => { pageRoute.value = router.currentRoute.value }, close: () => app.unmount() }
}

const families = [{ file: 'index.vue', base: '/meetings', row: 'meetingTo' }, { file: 'series.vue', base: '/meetings/series', row: 'seriesTo' }] as const
for (const family of families) {
  for (const target of ['record', 'create'] as const) {
    it(`${family.base}: a 400ms identity refresh cannot let the 250ms search replace ${target} navigation`, async () => {
      const view = await mountList(family.file, family.base, to => to.path !== family.base ? wait(400) : undefined)
      try {
        view.state.search.value = 'متابعة'
        await view.router.push(target === 'record' ? view.state[family.row]({ id: 9 }) : view.createTo())
        expect(view.router.currentRoute.value.path).toBe(`${family.base}/${target === 'record' ? '9' : 'new'}`)
        expect(view.router.currentRoute.value.query.returnTo).toBe(`${family.base}?q=%D9%85%D8%AA%D8%A7%D8%A8%D8%B9%D8%A9#agenda`)
      } finally { view.close() }
    })
  }
  it(`${family.base}: live return paths keep typed search, inherited filters and fragment and reset a stale offset`, async () => {
    const initial = `${family.base}?state=confirmed&mine=1&project_id=2&organizer_id=3&date_from=2026-10-01&date_to=2026-10-31&series_id=4&offset=25#agenda`
    const view = await mountList(family.file, family.base, () => undefined, false, initial)
    try {
      view.state.search.value = 'متابعة'
      for (const to of [view.state[family.row]({ id: 9 }), view.createTo()]) {
        const url = new URL(to.query.returnTo, 'https://example.test')
        expect(url.pathname).toBe(family.base); expect(url.hash).toBe('#agenda')
        expect(Object.fromEntries(url.searchParams)).toEqual({ state: 'confirmed', mine: '1', project_id: '2', organizer_id: '3', date_from: '2026-10-01', date_to: '2026-10-31', series_id: '4', q: 'متابعة' })
      }
    } finally { view.close() }
  })
  it(`${family.base}: failed departures resume search, failed own query writes stop, and later input can retry`, async () => {
    let refuseQuery = false, attempts = 0
    const view = await mountList(family.file, family.base, async to => {
      if (to.path !== family.base) { await wait(400); return false }
      if (to.query.q) { attempts++; if (refuseQuery) { await wait(10); return false } }
    })
    try {
      view.state.search.value = 'متابعة'; await view.router.push(view.state[family.row]({ id: 9 })); await wait(30)
      expect(view.router.currentRoute.value.query.q).toBe('متابعة'); expect(view.router.currentRoute.value.hash).toBe('#agenda')
      refuseQuery = true; attempts = 0; view.state.search.value = 'رفض'; await wait(450)
      expect(attempts).toBe(1); expect(view.state.search.value).toBe('رفض')
      refuseQuery = false; view.state.search.value = 'لاحق'; await wait(300)
      expect(attempts).toBe(2); expect(view.router.currentRoute.value.query.q).toBe('لاحق')
    } finally { refuseQuery = false; view.close() }
  })
  it(`${family.base}: explicit pagination supersedes a pending record and retains typed search`, async () => {
    const view = await mountList(family.file, family.base, to => to.path !== family.base ? wait(400) : undefined)
    try {
      view.state.search.value = 'متابعة'; const opening = view.router.push(view.state[family.row]({ id: 9 })); await wait(30)
      view.state.setPage(3); await opening; await wait(300)
      expect(view.router.currentRoute.value.path).toBe(family.base)
      expect(view.router.currentRoute.value.query.offset).toBe('50'); expect(view.router.currentRoute.value.query.q).toBe('متابعة'); expect(view.router.currentRoute.value.hash).toBe('#agenda')
    } finally { view.close() }
  })

  it(`${family.base}: row and create click handlers read input synchronously before Vue flush`, async () => {
    const view = await mountList(family.file, family.base, () => undefined)
    try {
      const click = (create: boolean) => {
        const event = { button: 0, defaultPrevented: false, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false,
          target: { closest: () => ({}) }, preventDefault() { this.defaultPrevented = true } }
        view.state.search.value = create ? 'إنشاء' : 'سجل'
        if (create) view.state.openCreate(event)
        else view.state.openRecord(event, { id: 9 })
        expect(event.defaultPrevented).toBe(true)
      }
      click(false); await wait(10)
      expect(view.router.currentRoute.value.path).toBe(`${family.base}/9`)
      expect(new URL(view.router.currentRoute.value.query.returnTo as string, 'https://example.test').searchParams.get('q')).toBe('سجل')
      await view.router.push(`${family.base}#agenda`)
      click(true); await wait(10)
      expect(view.router.currentRoute.value.path).toBe(`${family.base}/new`)
      expect(new URL(view.router.currentRoute.value.query.returnTo as string, 'https://example.test').searchParams.get('q')).toBe('إنشاء')
    } finally { view.close() }
  })
  it(`${family.base}: modified clicks and unrelated create capture events retain native behavior`, async () => {
    const view = await mountList(family.file, family.base, () => undefined)
    try {
      for (const modifier of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey', 'middle', 'prevented']) {
        const event = { button: modifier === 'middle' ? 1 : 0, defaultPrevented: modifier === 'prevented',
          metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, [modifier]: true,
          target: { closest: () => ({}) }, preventDefault() { throw new Error('native click intercepted') } }
        view.state.openRecord(event, { id: 9 }); view.state.openCreate(event)
      }
      view.state.openCreate({ button: 0, target: { closest: () => null }, preventDefault() { throw new Error('unrelated click intercepted') } })
      await wait(10)
      expect(view.started).toHaveLength(0)
    } finally { view.close() }
  })
  it(`${family.base}: deferred Nuxt page state cannot write onto a departed record`, async () => {
    const view = await mountList(family.file, family.base, () => undefined, true)
    try {
      await view.router.push(view.state[family.row]({ id: 9 }))
      view.state.search.value = 'متأخر'; await wait(300)
      expect(view.router.currentRoute.value.path).toBe(`${family.base}/9`)
      expect(view.router.currentRoute.value.query.q).toBeUndefined()
      expect(view.started).toHaveLength(1)
    } finally { view.close() }
  })
  it(`${family.base}: typing during an own query write preserves the newer draft`, async () => {
    const view = await mountList(family.file, family.base, to => to.query.q ? wait(400) : undefined)
    try {
      view.state.search.value = 'الأول'; await wait(300)
      view.state.search.value = 'الأحدث'; await wait(800)
      expect(view.state.search.value).toBe('الأحدث')
      expect(view.router.currentRoute.value.query.q).toBe('الأحدث')
      expect(view.router.currentRoute.value.hash).toBe('#agenda')
    } finally { view.close() }
  })

  it(`${family.base}: an older cancelled departure cannot resume search over its newer target`, async () => {
    const view = await mountList(family.file, family.base, to => to.path.endsWith('/9') ? wait(400) : to.path.endsWith('/10') ? wait(500) : undefined)
    try {
      view.state.search.value = 'متابعة'
      const older = view.router.push(view.state[family.row]({ id: 9 })); await wait(20)
      const newer = view.router.push(view.state[family.row]({ id: 10 }))
      await Promise.all([older, newer]); await wait(20)
      expect(view.router.currentRoute.value.path).toBe(`${family.base}/10`)
      expect(view.started.map(to => to.path)).toEqual([`${family.base}/9`, `${family.base}/10`])
    } finally { view.close() }
  })
  it(`${family.base}: live return paths preserve a pending explicit project filter`, async () => {
    const view = await mountList(family.file, family.base, to => to.path === family.base ? wait(400) : undefined)
    try {
      view.state.search.value = 'متابعة'; view.state.setProject(17)
      const returned = new URL(view.state[family.row]({ id: 9 }).query.returnTo, 'https://example.test')
      expect(returned.searchParams.get('project_id')).toBe('17'); expect(returned.searchParams.get('q')).toBe('متابعة')
      expect(returned.hash).toBe('#agenda')
      await wait(450)
      expect(view.router.currentRoute.value.query.project_id).toBe('17')
    } finally { view.close() }
  })
  it(`${family.base}: handler auth errors preserve the draft and resume local search without an unhandled rejection`, async () => {
    const view = await mountList(family.file, family.base, to => { if (to.path !== family.base) throw new Error('identity refresh failed') })
    try {
      for (const create of [false, true]) {
        const event = { button: 0, defaultPrevented: false, target: { closest: () => ({}) }, preventDefault() { this.defaultPrevented = true } }
        view.state.search.value = create ? 'إنشاء' : 'سجل'
        if (create) view.state.openCreate(event)
        else view.state.openRecord(event, { id: 9 })
        await wait(300)
        expect(event.defaultPrevented).toBe(true)
        expect(view.router.currentRoute.value.path).toBe(family.base)
        expect(view.router.currentRoute.value.query.q).toBe(create ? 'إنشاء' : 'سجل')
        expect(view.router.currentRoute.value.hash).toBe('#agenda')
      }
    } finally { view.close() }
  })
  it(`${family.base}: hydration, create permission and a backing list prevent intercepted navigation`, async () => {
    const view = await mountList(family.file, family.base, () => undefined)
    try {
      const event = { button: 0, defaultPrevented: false, target: { closest: () => ({}) }, preventDefault() { throw new Error('inert control intercepted') } }
      view.state.hydrated.value = false
      view.state.openRecord(event, { id: 9 }); view.state.openCreate(event)
      view.state.hydrated.value = true; view.permission.value = false; view.state.openCreate(event)
      expect(view.started).toHaveLength(0)
      await view.router.push(`${family.base}/new`)
      view.permission.value = true
      view.state.openRecord(event, { id: 9 }); view.state.openCreate(event)
      expect(view.started).toHaveLength(1)
      expect(view.router.currentRoute.value.path).toBe(`${family.base}/new`)
    } finally { view.close() }
  })

  for (const link of ['desktop', 'mobile'] as const) {
    it(`${family.base}: real RouterLink ${link} listener order uses live returnTo before Vue flush`, async () => {
      const view = await mountList(family.file, family.base, to => to.path !== family.base ? wait(400) : undefined, false, `${family.base}#agenda`, link)
      try {
        const anchor = view.anchors[0]
        expect(new URL(anchor.props.href, 'https://example.test').searchParams.get('returnTo')).toBe(`${family.base}#agenda`)
        const event = { button: 0, defaultPrevented: false, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false,
          currentTarget: { getAttribute: () => null }, preventDefault() { this.defaultPrevented = true } }
        const invoke = (handlers: any) => { for (const handler of Array.isArray(handlers) ? handlers : handlers ? [handlers] : []) handler(event) }
        view.state.search.value = 'نص حي'
        // Match native event phases, with no await/nextTick between input and click.
        invoke(anchor.props.onClickCapture); invoke(anchor.props.onClick)
        await expect.poll(() => view.router.currentRoute.value.path).toBe(`${family.base}/9`)
        const returned = new URL(view.router.currentRoute.value.query.returnTo as string, 'https://example.test')
        expect(returned.searchParams.get('q')).toBe('نص حي'); expect(returned.hash).toBe('#agenda')
        expect(view.started.map(to => to.path)).toEqual([`${family.base}/9`])
      } finally { view.close() }
    })
  }

  for (const deferred of [false, true]) it(`${family.base}: an external list with different dates supersedes a pending own query without a stale hydration write (deferred=${deferred})`, async () => {
    const first = gate()
    const view = await mountList(family.file, family.base, to => to.query.q === 'first' && !to.query.date_from ? first.hold() : undefined, deferred)
    try {
      view.state.search.value = 'first'; await first.started
      const external = `${family.base}?q=external&date_from=2026-10-14#external`
      await view.router.push(external); await Vue.nextTick(); await wait(30)
      expect(view.router.currentRoute.value.fullPath).toBe(external)
      expect(view.state.search.value).toBe('external')
      expect(view.started.map(to => to.query.q)).toEqual(['first', 'external'])
      view.syncPageRoute(); await Vue.nextTick()
      first.release(); await wait(50)
      expect(view.router.currentRoute.value.fullPath).toBe(external)
      expect(view.state.search.value).toBe('external')
      const returned = new URL(view.state[family.row]({ id: 9 }).query.returnTo, 'https://example.test')
      expect(returned.searchParams.get('q')).toBe('external'); expect(returned.searchParams.get('date_from')).toBe('2026-10-14')
      expect(returned.hash).toBe('#external')
    } finally { first.release(); view.close() }
  })

  it(`${family.base}: a settled older write cannot overwrite typing after a newer external list`, async () => {
    const first = gate()
    const view = await mountList(family.file, family.base, to => to.query.q === 'first' && !to.query.date_from ? first.hold() : undefined)
    try {
      view.state.search.value = 'first'; await first.started
      await view.router.push(`${family.base}?q=external&date_from=2026-10-14#external`)
      view.state.search.value = 'new human input'
      first.release(); await wait(30)
      expect(view.state.search.value).toBe('new human input')
      await wait(300)
      expect(view.router.currentRoute.value.query.q).toBe('new human input')
      expect(view.router.currentRoute.value.query.date_from).toBe('2026-10-14')
      expect(view.router.currentRoute.value.hash).toBe('#external')
    } finally { first.release(); view.close() }
  })

  it(`${family.base}: a disposed old list cannot write its draft onto a newly mounted list`, async () => {
    const first = gate()
    const view = await mountList(family.file, family.base, to => to.query.q === 'first' && !to.query.date_from ? first.hold() : undefined)
    try {
      const old = view.state
      old.search.value = 'first'; await first.started
      // The old writer remains pending after a newer list intent commits.
      await view.router.push(`${family.base}?q=external&date_from=2026-10-14#external`)
      old.search.value = 'old uncommitted draft'; await wait(300)
      await view.router.push('/outside')
      await view.router.push(`${family.base}?q=current#new-list`)
      expect(view.state).not.toBe(old)
      const attemptsBeforeRelease = view.started.length
      first.release(); await wait(350)
      expect(view.router.currentRoute.value.fullPath).toBe(`${family.base}?q=current#new-list`)
      expect(view.state.search.value).toBe('current')
      expect(view.started).toHaveLength(attemptsBeforeRelease)
    } finally { first.release(); view.close() }
  })

  it(`${family.base}: a separate normalized navigation to the exact same query owns later human input`, async () => {
    const first = gate()
    let matchingAttempts = 0
    const view = await mountList(family.file, family.base, to => {
      if (to.query.q === 'first' && ++matchingAttempts === 1) return first.hold()
    })
    try {
      view.state.search.value = 'first'; await first.started
      const firstTarget = view.started[0]!
      await view.router.push(firstTarget.fullPath)
      expect(view.started[1]!.fullPath).toBe(firstTarget.fullPath)
      expect(view.started[1]).not.toBe(firstTarget)
      view.state.search.value = 'later human input'
      first.release(); await wait(30)
      expect(view.state.search.value).toBe('later human input')
      await wait(300)
      expect(view.router.currentRoute.value.query.q).toBe('later human input')
      expect(view.router.currentRoute.value.hash).toBe('#agenda')
      expect(view.started).toHaveLength(3)
    } finally { first.release(); view.close() }
  })

}

it('/meetings: a synchronous date edit is included in both live record and create return paths', async () => {
  const view = await mountList('index.vue', '/meetings', () => undefined)
  try {
    view.state.dateFrom.value = '2026-10-14'
    view.state.dateTo.value = '2026-10-31'
    for (const to of [view.state.meetingTo({ id: 9 }), view.createTo()]) {
      const returned = new URL(to.query.returnTo, 'https://example.test')
      expect(returned.searchParams.get('date_from')).toBe('2026-10-14')
      expect(returned.searchParams.get('date_to')).toBe('2026-10-31')
      expect(returned.hash).toBe('#agenda')
    }
    await wait(10)
  } finally { view.close() }
})
it('/meetings: removing individual local filters does not restore them in live return paths', async () => {
  const view = await mountList('index.vue', '/meetings', () => undefined, false, '/meetings?state=confirmed&mine=1&date_from=2026-10-14&date_to=2026-10-31#agenda')
  try {
    for (const key of ['state', 'mine', 'date_from', 'date_to', 'q']) {
      view.state.clearFilter(key)
      const returned = new URL(view.state.meetingTo({ id: 9 }).query.returnTo, 'https://example.test')
      expect(returned.searchParams.has(key)).toBe(false)
      await wait(10)
      expect(view.router.currentRoute.value.query[key]).toBeUndefined()
    }
  } finally { view.close() }
})

it('/meetings: a genuine user date edit supersedes a pending own search write', async () => {
  const first = gate()
  const view = await mountList('index.vue', '/meetings', to => to.query.q === 'first' && !to.query.date_from ? first.hold() : undefined)
  try {
    view.state.search.value = 'first'; await first.started
    view.state.dateFrom.value = '2026-10-14'; await Vue.nextTick(); await wait(30)
    expect(view.router.currentRoute.value.query.q).toBe('first')
    expect(view.router.currentRoute.value.query.date_from).toBe('2026-10-14')
    expect(view.router.currentRoute.value.hash).toBe('#agenda')
    first.release(); await wait(50)
    expect(view.router.currentRoute.value.query.date_from).toBe('2026-10-14')
    expect(view.state.search.value).toBe('first')
  } finally { first.release(); view.close() }
})
