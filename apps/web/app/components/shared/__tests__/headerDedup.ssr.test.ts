import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import {
  computed,
  createCommentVNode,
  createElementBlock,
  createElementVNode,
  createSSRApp,
  createTextVNode,
  createVNode,
  defineComponent,
  h,
  openBlock,
  ref,
  renderSlot,
  resolveComponent,
  toDisplayString,
  unref,
  withCtx,
} from 'vue'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { projectIdFromPath, projectSectionRoot } from '../../../composables/useShellNavigation'

const pageHeaderFile = resolve(import.meta.dirname, '../PageHeader.vue')

const ArrowRightStub = defineComponent({ render: () => h('span', { 'aria-hidden': 'true' }) })
const NuxtLinkStub = defineComponent({
  props: { to: { type: [String, Object], default: '#' } },
  setup(props, { slots }) {
    return () => h('a', { href: typeof props.to === 'string' ? props.to : '#' }, slots.default?.())
  },
})

function loadPageHeader() {
  const source = readFileSync(pageHeaderFile, 'utf8')
  const descriptor = parse(source, { filename: pageHeaderFile }).descriptor
  const compiled = compileScript(descriptor, { id: 'header-dedup', inlineTemplate: true }).content
  const script = compiled.replace(/^import .*$/gm, '').replace('export default', 'return')
  const javascript = ts.transpileModule(script, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  }).outputText
  const runtimeBindings = {
    _defineComponent: defineComponent,
    _unref: unref,
    _renderSlot: renderSlot,
    _createVNode: createVNode,
    _createTextVNode: createTextVNode,
    _toDisplayString: toDisplayString,
    _resolveComponent: resolveComponent,
    _withCtx: withCtx,
    _openBlock: openBlock,
    _createElementBlock: createElementBlock,
    _createCommentVNode: createCommentVNode,
    _createElementVNode: createElementVNode,
  }
  const names = [
    ...Object.keys(runtimeBindings), 'ArrowRight', 'computed', 'useRoute', 'useRouter',
    'useShellBreadcrumbTarget', 'projectIdFromPath', 'projectSectionRoot', 'usePageHeader',
  ]
  const values = [
    ...Object.values(runtimeBindings), ArrowRightStub, computed,
    () => currentRoute,
    () => ({ resolve: (to: string | { path: string }) => ({ fullPath: typeof to === 'string' ? to : to.path }) }),
    () => ref(currentBreadcrumb), projectIdFromPath, projectSectionRoot, () => undefined,
  ]
  return new Function(...names, javascript)(...values)
}

let currentRoute = { path: '/projects/1', fullPath: '/projects/1', query: {} as Record<string, unknown> }
let currentBreadcrumb = { routeKey: '', href: null as string | null }

async function renderHeader(props: Record<string, unknown>) {
  const app = createSSRApp({ render: () => h(loadPageHeader(), props) })
  app.component('NuxtLink', NuxtLinkStub)
  return renderToString(app)
}

describe('rendered project header deduplication', () => {
  it('removes project identity, back, and generic description from a project root', async () => {
    currentRoute = { path: '/projects/1', fullPath: '/projects/1', query: {} }
    currentBreadcrumb = { routeKey: '/projects/1', href: null }
    const html = await renderHeader({ title: 'الملخص', eyebrow: 'مشروع ألفا', description: 'وصف عام', backTo: '/projects', backLabel: 'العودة' })

    expect(html).toContain('الملخص')
    expect(html).not.toContain('مشروع ألفا')
    expect(html).not.toContain('وصف عام')
    expect(html).not.toContain('href="/projects"')
  })

  it('suppresses only a deep back link that matches the visible project breadcrumb', async () => {
    currentRoute = { path: '/projects/1/tasks/101', fullPath: '/projects/1/tasks/101?tab=tasks&returnTo=%2Fprojects%2F1%3Ftab%3Dtasks', query: { tab: 'tasks' } }
    currentBreadcrumb = { routeKey: currentRoute.fullPath, href: '/projects/1?tab=tasks' }
    const duplicate = await renderHeader({ title: 'مهمة جارية', eyebrow: 'مشروع ألفا', backTo: '/projects/1?tab=tasks', backLabel: 'العودة' })
    const distinct = await renderHeader({ title: 'مهمة جارية', eyebrow: 'مشروع ألفا', backTo: '/projects/1/tasks?tab=tasks', backLabel: 'العودة' })

    expect(duplicate).not.toContain('href="/projects/1?tab=tasks"')
    expect(distinct).toContain('href="/projects/1/tasks?tab=tasks"')
    expect(duplicate).not.toContain('مشروع ألفا')
  })

  it('keeps ordinary non-project header context intact', async () => {
    currentRoute = { path: '/hr/employees/new', fullPath: '/hr/employees/new', query: {} }
    currentBreadcrumb = { routeKey: '/hr/employees/new', href: null }
    const html = await renderHeader({ title: 'موظف جديد', eyebrow: 'الموظفون', description: 'أضف موظفًا', backTo: '/hr', backLabel: 'رجوع' })

    expect(html).toContain('الموظفون')
    expect(html).toContain('أضف موظفًا')
    expect(html).toContain('href="/hr"')
  })
})
