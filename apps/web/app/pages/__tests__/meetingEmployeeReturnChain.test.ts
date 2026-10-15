import * as recordNavigation from '../../utils/recordListOrigin'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { createMemoryHistory, createRouter, type RouteLocationRaw } from 'vue-router'
import { createHooks } from 'hookable'
import { describe, expect, it, vi } from 'vitest'
import { returnToQuery } from '../../utils/safeReturnTo'
import * as tabs from '../../utils/meetingTabs'
import * as filters from '../../utils/meetingListFilters'
import { parseOffset, firstQuery } from '../../utils/routeQuery'

const root = resolve(import.meta.dirname, '../..')
const read = (file: string) => readFileSync(resolve(root, file), 'utf8')
const emptyQuery = () => ({ data: Vue.ref(undefined), isLoading: Vue.ref(false), isFetching: Vue.ref(false), isPending: Vue.ref(false), error: Vue.ref(null), refetch: vi.fn(), mutateAsync: vi.fn(async () => ({})) })
async function load(file: string, url: RouteLocationRaw) {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    ...['/meetings/series/:id/edit', '/meetings/series/:id', '/meetings/:id/resolutions/:resolutionId/edit', '/meetings/:id/resolutions/new', '/meetings/:id/:child', '/meetings/:id', '/hr/employees/:employeeId/edit', '/hr/employees/:employeeId', '/:pathMatch(.*)*'].map(path => ({ path, component: {} })),
  ] })
  await router.push(url)
  const hooks = createHooks()
  router.beforeEach(to => hooks.callHook('nasq:navigation:start', to))
  const descriptor = parse(read(file), { filename: file }).descriptor
  const code = compileScript(descriptor, { id: 'return-chain' }).content.replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replaceAll('import.meta.client', 'false').replace('export default', 'return')
  const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText
  const navigate = vi.fn(async (_to: RouteLocationRaw) => {})
  const bindings: Record<string, unknown> = {
    ...recordNavigation,
    // Namespace metadata such as Node's `module.exports` is not a Function parameter.
    computed: Vue.computed, ref: Vue.ref, watch: Vue.watch, nextTick: Vue.nextTick,
    ...tabs, ...filters, parseOffset, firstQuery, returnToQuery, _defineComponent: Vue.defineComponent,
    onMounted: () => {}, onBeforeUnmount: () => {}, onUnmounted: () => {}, onScopeDispose: Vue.onScopeDispose,
    useNuxtApp: () => ({ hook: hooks.hook }),
    useRoute: () => router.currentRoute.value, useRouter: () => router,
    useI18n: () => ({ t: (key: string) => key, locale: Vue.ref('ar') }), useHydrated: () => Vue.ref(true),
    useAccess: () => ({ can: () => true }), useMe: () => ({ me: Vue.ref({}) }), useToast: () => ({ add: vi.fn() }),
    useBranding: () => ({ branding: Vue.ref({}) }), useSsrQuerySeed: () => {}, navigateTo: navigate,
    refDebounced: (value: unknown) => value, createMeetingMinutesForm: () => ({}),
  }
  for (let tries = 0; tries < 80; tries++) {
    const scope = Vue.effectScope()
    try {
      const component = new Function(...Object.keys(bindings), js)(...Object.values(bindings))
      const state = scope.run(() => component.setup({ employees: [], params: {}, departments: [] }, { expose: () => {}, emit: vi.fn() }))
      return { state, router, navigate, file, stop: () => scope.stop() }
    } catch (error) {
      scope.stop()
      const missing = error instanceof ReferenceError ? /(\w+) is not defined/.exec(error.message)?.[1] : undefined
      if (missing) { bindings[missing] = missing.startsWith('use') ? emptyQuery : {}; continue }
      const notCallable = error instanceof TypeError ? /(\w+) is not a function/.exec(error.message)?.[1] : undefined
      if (notCallable && typeof bindings[notCallable] !== 'function') { bindings[notCallable] = emptyQuery; continue }
      throw error
    }
  }
  throw new Error('Unresolved setup binding')
}
function target(page: Awaited<ReturnType<typeof load>>) { return page.router.resolve(page.state.backTo.value) }
// Evaluate the actual template's bound location, including row-local variables.
function templateTo(page: Awaited<ReturnType<typeof load>>, marker: string, locals: Record<string, unknown> = {}) {
  const tag = [...read(page.file).matchAll(/<(?:UButton|NuxtLink)\b[\s\S]*?>/g)].find(match => match[0].includes(marker))?.[0]
  // A menu item (`{ label: t('…'), to: childTo(…) }`) carries the link when the action lives in a dropdown.
  const item = read(page.file).match(new RegExp(`label: ${marker.replace(/[()'.]/g, '\\$&')}[^\\n]*?\\bto: (.+?) \\}\\]`))?.[1]?.replace(/\.value\b/g, '') // script refs are unwrapped by the proxy
  const expression = item ?? tag?.match(/:to="([^"]+)"/)?.[1]
  if (!expression) throw new Error(`No link: ${marker}`)
  return new Function('scope', `with(scope) { return (${expression}) }`)(Object.assign(Object.create(Vue.proxyRefs(page.state)), locals)) as RouteLocationRaw
}
const meeting = 'pages/meetings/[id].vue'
const employee = 'pages/hr/employees/[employeeId].vue'
const series = 'pages/meetings/series/[id].vue'

describe('meeting and employee owning-list return context', () => {
  it.each([
    ['pages/meetings/index.vue', '/meetings?q=review&offset=25#list'],
    ['pages/meetings/calendar.vue', '/meetings/calendar?year=2026&month=10#day-9'],
  ])('keeps the real %s producer context through repeated record/edit/back cycles', async (file, origin) => {
    const list = await load(file, origin)
    const selected = file.includes('calendar') ? templateTo(list, 'path: `/meetings/${meeting.id}`', { meeting: { id: 7 } }) : list.state.meetingTo({ id: 7 })
    let detail = await load(meeting, selected)
    expect(target(detail).fullPath).toBe(origin)
    const firstEdit = detail.router.resolve(templateTo(detail, "t('app.edit')")).fullPath
    for (let i = 0; i < 3; i++) {
      const edit = await load('pages/meetings/[id]/edit.vue', templateTo(detail, "t('app.edit')"))
      expect(target(edit).path).toBe('/meetings/7')
      detail.stop()
      detail = await load(meeting, edit.state.backTo.value)
      expect(target(detail).fullPath).toBe(origin)
      expect(detail.router.resolve(templateTo(detail, "t('app.edit')")).fullPath).toBe(firstEdit)
      edit.stop()
    }
    list.stop(); detail.stop()
  })

  it.each([
    ["t('meetingsUx.editMinutes')", 'pages/meetings/[id]/minutes.vue'],
    ["t('meetingMinutesForm.printPreview')", 'pages/meetings/[id]/print.vue'],
    ["t('meetingsUi.newResolution')", 'pages/meetings/[id]/resolutions/new.vue'],
    ["t('meetingsUi.editResolution')", 'pages/meetings/[id]/resolutions/[resolutionId]/edit.vue'],
  ])('keeps %s inside its meeting and preserves the calendar origin', async (marker, file) => {
    const origin = '/meetings/calendar?year=2026&month=10#day-9'
    const detail = await load(meeting, { path: '/meetings/7', query: { returnTo: origin, tab: 'minutes' }, hash: '#minutes' })
    const child = await load(file, templateTo(detail, marker, { item: { id: 9 } }))
    expect(target(child).path).toBe('/meetings/7')
    const returned = await load(meeting, child.state.backTo.value)
    expect(target(returned).fullPath).toBe(origin)
    expect(returned.router.currentRoute.value.hash).toBe('#minutes')
    detail.stop(); child.stop(); returned.stop()
  })

  it('preserves series-list context through series settings', async () => {
    const origin = '/meetings/series?q=weekly&offset=25#series'
    const list = await load('pages/meetings/series.vue', origin)
    const detail = await load(series, templateTo(list, 'seriesTo(series)', { series: { id: 12 } }))
    expect(target(detail).fullPath).toBe(origin)
    const edit = await load('pages/meetings/series/[id]/edit.vue', templateTo(detail, "t('meetingsUx.seriesSettingsLink')"))
    expect(target(edit).path).toBe('/meetings/series/12')
    const returned = await load(series, edit.state.backTo.value)
    expect(target(returned).fullPath).toBe(origin)
    list.stop(); detail.stop(); edit.stop(); returned.stop()
  })

  it('preserves the directory producer context through employee edit and saved navigation', async () => {
    const origin = '/hr?q=name&department_id=3&offset=25#employees'
    const list = await load('components/hr/DirectoryTable.vue', origin)
    const detail = await load(employee, list.state.employeeTo(12))
    expect(target(detail).fullPath).toBe(origin)
    const edit = await load('pages/hr/employees/[employeeId]/edit.vue', templateTo(detail, "t('app.edit')"))
    expect(target(edit).path).toBe('/hr/employees/12')
    edit.state.saved()
    const returned = await load(employee, edit.navigate.mock.calls[0]![0])
    expect(target(returned).fullPath).toBe(origin)
    list.stop(); detail.stop(); edit.stop(); returned.stop()
  })

  it('preserves the directory Manage action while still returning through the employee record', async () => {
    const origin = '/hr?q=name&department_id=3&offset=25#employees'
    const list = await load('pages/hr/index.vue', origin)
    list.state.editEmployee(12)
    const edit = await load('pages/hr/employees/[employeeId]/edit.vue', list.navigate.mock.calls[0]![0])
    expect(target(edit).path).toBe('/hr/employees/12')
    const returned = await load(employee, edit.state.backTo.value)
    expect(target(returned).fullPath).toBe(origin)
    list.stop(); edit.stop(); returned.stop()
  })

  it('consumes nested navigation metadata instead of growing recursive return paths', async () => {
    const origin = '/meetings/calendar?month=10&returnTo=%2Fmeetings&listOrigin=%2Fsettings#day'
    const detail = await load(meeting, { path: '/meetings/7', query: { returnTo: origin } })
    expect(target(detail).fullPath).toBe('/meetings/calendar?month=10#day')
    const edit = await load('pages/meetings/[id]/minutes.vue', templateTo(detail, "t('meetingsUx.editMinutes')"))
    expect(target(edit).query.returnTo).toBe('/meetings/calendar?month=10#day')
    expect(target(edit).query.listOrigin).toBeUndefined()
    detail.stop(); edit.stop()
  })

  it.each([['/meetings', '/meetings/calendar'], '/meetings/88', '//evil.test'])('rejects ambiguous or non-owning child list context %j', async listOrigin => {
    const edit = await load('pages/meetings/[id]/minutes.vue', { path: '/meetings/7/minutes', query: { listOrigin, q: 'review' } })
    expect(target(edit).fullPath).toBe('/meetings/7?q=review')
    edit.stop()
  })

  it.each(['https://evil.test', '//evil.test', '/meetings/88', '/meetings/calendar/nested', '/settings/users'])('rejects non-owning meeting origin %s and preserves direct state', async origin => {
    const page = await load(meeting, { path: '/meetings/7', query: { returnTo: origin, q: 'review' }, hash: '#section' })
    expect(target(page).fullPath).toBe('/meetings?q=review#section')
    page.stop()
  })
  it.each(['/hr/departments', '/hr/employees/88', '//evil.test'])('rejects non-directory employee origin %s', async origin => {
    const page = await load(employee, { path: '/hr/employees/12', query: { returnTo: origin, q: 'name' } })
    expect(target(page).fullPath).toBe('/hr?q=name')
    page.stop()
  })
})
