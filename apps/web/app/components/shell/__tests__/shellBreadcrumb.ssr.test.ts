import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import {
  computed,
  createBlock,
  createCommentVNode,
  createElementBlock,
  createSSRApp,
  createTextVNode,
  createVNode,
  defineComponent,
  Fragment,
  h,
  openBlock,
  reactive,
  ref,
  renderList,
  resolveComponent,
  toDisplayString,
  unref,
  withCtx,
  watchEffect,
} from 'vue'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { shellBreadcrumbsForDisplay } from '../../../composables/useShellNavigation'

const componentFile = resolve(import.meta.dirname, '../ShellBreadcrumb.vue')
const ChevronLeftStub = defineComponent({ render: () => h('span', { 'aria-hidden': 'true' }) })
const NuxtLinkStub = defineComponent({
  props: { to: { type: [String, Object], default: '#' } },
  setup(props, { slots }) {
    return () => h('a', { href: typeof props.to === 'string' ? props.to : '#' }, slots.default?.())
  },
})

const route = reactive({ path: '/meetings/new', fullPath: '/meetings/new', query: {} as Record<string, unknown> })
const breadcrumbs = ref<{ id: string; labelKey: string; to?: string; current?: boolean }[]>([])
const contextLinks = ref<{ to: string }[]>([])
const breadcrumbTarget = ref({ routeKey: '', href: null as string | null })

function resolveRoute(to: string | { path?: string; query?: Record<string, unknown> }) {
  const path = typeof to === 'string' ? to : to.path ?? ''
  const query = typeof to === 'string' ? undefined : to.query
  const params = new URLSearchParams(query as Record<string, string> | undefined).toString()
  const parsed = new URL(`${path}${params ? `?${params}` : ''}`, 'http://nasq.local')
  return {
    fullPath: `${parsed.pathname}${parsed.search}${parsed.hash}`,
    path: parsed.pathname,
    query: Object.fromEntries(parsed.searchParams.entries()),
    hash: parsed.hash,
  }
}

function loadBreadcrumb() {
  const descriptor = parse(readFileSync(componentFile, 'utf8'), { filename: componentFile }).descriptor
  const compiled = compileScript(descriptor, { id: 'shell-breadcrumb-ssr', inlineTemplate: true }).content
  const script = compiled.replace(/^import .*$/gm, '').replace('export default', 'return')
  const javascript = ts.transpileModule(script, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  }).outputText
  const runtimeBindings = {
    _defineComponent: defineComponent,
    _unref: unref,
    _renderList: renderList,
    _Fragment: Fragment,
    _openBlock: openBlock,
    _createElementBlock: createElementBlock,
    _createBlock: createBlock,
    _createCommentVNode: createCommentVNode,
    _toDisplayString: toDisplayString,
    _createTextVNode: createTextVNode,
    _createVNode: createVNode,
    _resolveComponent: resolveComponent,
    _withCtx: withCtx,
  }
  const names = [
    ...Object.keys(runtimeBindings), 'ChevronLeft', 'computed', 'watchEffect',
    'useI18n', 'useMe', 'useRoute', 'useRouter', 'useShellNavigation',
    'useShellBreadcrumbTarget', 'shellBreadcrumbsForDisplay',
  ]
  const values = [
    ...Object.values(runtimeBindings), ChevronLeftStub, computed, watchEffect,
    () => ({ t: (key: string) => key, localeProperties: { dir: 'rtl' } }),
    () => ({ me: ref(undefined) }),
    () => route,
    () => ({ resolve: resolveRoute }),
    () => ({ breadcrumbs, contextLinks }),
    () => breadcrumbTarget,
    shellBreadcrumbsForDisplay,
  ]
  return new Function(...names, javascript)(...values)
}

async function renderBreadcrumb() {
  const app = createSSRApp({ render: () => h(loadBreadcrumb()) })
  app.component('NuxtLink', NuxtLinkStub)
  return renderToString(app)
}

function setRoute(path: string, fullPath = path) {
  route.path = path
  route.fullPath = fullPath
}

describe('rendered shell breadcrumb deduplication', () => {
  it('hides a generic ancestor already represented by contextual navigation', async () => {
    setRoute('/meetings/new')
    breadcrumbs.value = [{ id: 'meetings', labelKey: 'nav.meetings', to: '/meetings' }]
    contextLinks.value = [{ to: '/meetings' }]

    const html = await renderBreadcrumb()

    expect(html).not.toContain('data-testid="shell-breadcrumb"')
    expect(breadcrumbTarget.value).toEqual({ routeKey: '/meetings/new', href: '/meetings' })
  })

  it('keeps a filtered ancestor whose destination differs from the context link', async () => {
    setRoute('/meetings/new', '/meetings/new?returnTo=%2Fmeetings%2Fcalendar%3Fdate%3D2026-09-08')
    breadcrumbs.value = [{ id: 'calendar', labelKey: 'nav.meetingCalendar', to: '/meetings/calendar?date=2026-09-08' }]
    contextLinks.value = [{ to: '/meetings/calendar' }]

    const html = await renderBreadcrumb()

    expect(html).toContain('data-testid="shell-breadcrumb"')
    expect(html).toContain('href="/meetings/calendar?date=2026-09-08"')
    expect(breadcrumbTarget.value).toEqual({ routeKey: route.fullPath, href: '/meetings/calendar?date=2026-09-08' })
  })

  it('does not hide an ancestor when the contextual destination is unavailable', async () => {
    setRoute('/hr/employees/1')
    breadcrumbs.value = [{ id: 'employees', labelKey: 'nav.employees', to: '/hr' }]
    contextLinks.value = []

    const html = await renderBreadcrumb()

    expect(html).toContain('data-testid="shell-breadcrumb"')
    expect(html).toContain('href="/hr"')
  })

  it('drops an explicitly registered current crumb', async () => {
    setRoute('/meetings/new')
    breadcrumbs.value = [{ id: 'current', labelKey: 'meetingsUi.new', current: true }]
    contextLinks.value = []

    const html = await renderBreadcrumb()

    expect(html).not.toContain('data-testid="shell-breadcrumb"')
    expect(breadcrumbTarget.value).toEqual({ routeKey: '/meetings/new', href: null })
  })

})
