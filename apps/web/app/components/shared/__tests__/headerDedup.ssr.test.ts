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
  renderSlot,
  resolveComponent,
  toDisplayString,
  unref,
  withCtx,
} from 'vue'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { projectIdFromPath, projectSectionRoot, shellRootBackTargets, shellSectionRoot } from '../../../composables/useShellNavigation'

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
    'useI18n', 'projectIdFromPath', 'projectSectionRoot', 'shellSectionRoot', 'shellRootBackTargets', 'usePageHeader',
  ]
  const values = [
    ...Object.values(runtimeBindings), ArrowRightStub, computed,
    () => currentRoute,
    () => ({ resolve: (to: string | { path: string }) => {
      const fullPath = typeof to === 'string' ? to : to.path
      const parsed = new URL(fullPath, 'http://nasq.local')
      return {
        fullPath,
        path: parsed.pathname,
        hash: parsed.hash,
        query: Object.fromEntries(parsed.searchParams.entries()),
      }
    } }),
    () => ({ t: (key: string) => ({ 'nav.employees': 'الموظفون', 'nav.tasks': 'المهام' }[key] ?? key) }),
    projectIdFromPath, projectSectionRoot, shellSectionRoot, shellRootBackTargets, () => undefined,
  ]
  return new Function(...names, javascript)(...values)
}

let currentRoute = { path: '/projects/1', fullPath: '/projects/1', query: {} as Record<string, unknown> }
async function renderHeader(props: Record<string, unknown>, slots: Record<string, () => unknown> = {}) {
  const app = createSSRApp({ render: () => h(loadPageHeader(), props, slots) })
  app.component('NuxtLink', NuxtLinkStub)
  return renderToString(app)
}

describe('rendered page header navigation policies', () => {
  it('removes project identity, back, and generic description from a project root', async () => {
    currentRoute = { path: '/projects/1', fullPath: '/projects/1', query: {} }
    const html = await renderHeader({ title: 'الملخص', eyebrow: 'مشروع ألفا', description: 'وصف عام', backTo: '/projects', backLabel: 'العودة' })

    expect(html).toContain('الملخص')
    expect(html).not.toContain('مشروع ألفا')
    expect(html).not.toContain('وصف عام')
    expect(html).not.toContain('href="/projects"')
  })

  it('keeps deep back links, including one that previously matched a breadcrumb', async () => {
    currentRoute = { path: '/projects/1/tasks/101', fullPath: '/projects/1/tasks/101?tab=tasks&returnTo=%2Fprojects%2F1%3Ftab%3Dtasks', query: { tab: 'tasks' } }
    const duplicate = await renderHeader({ title: 'مهمة جارية', eyebrow: 'مشروع ألفا', backTo: '/projects/1?tab=tasks', backLabel: 'العودة' })
    const distinct = await renderHeader({ title: 'مهمة جارية', eyebrow: 'مشروع ألفا', backTo: '/projects/1/tasks?tab=tasks', backLabel: 'العودة' })

    expect(duplicate).toContain('href="/projects/1?tab=tasks"')
    expect(distinct).toContain('href="/projects/1/tasks?tab=tasks"')
    expect(duplicate).not.toContain('مشروع ألفا')
  })

  it('keeps ordinary non-project header context intact', async () => {
    currentRoute = { path: '/hr/employees/new', fullPath: '/hr/employees/new', query: {} }
    const html = await renderHeader({ title: 'موظف جديد', eyebrow: 'إرشادات الموظف', description: 'أضف موظفًا', backTo: '/hr', backLabel: 'رجوع' })

    expect(html).toContain('إرشادات الموظف')
    expect(html).toContain('أضف موظفًا')
    expect(html).toContain('href="/hr"')
  })

  it('suppresses a generic shell root back but keeps a distinct hash return', async () => {
    currentRoute = { path: '/meetings/calendar', fullPath: '/meetings/calendar', query: {} }
    const duplicate = await renderHeader({ title: 'التقويم', description: 'وصف عام', backTo: '/meetings', backLabel: 'العودة' })
    const anchored = await renderHeader({ title: 'التقويم', description: 'وصف عام', backTo: '/meetings#calendar', backLabel: 'العودة' })

    expect(duplicate).not.toContain('href="/meetings"')
    expect(anchored).toContain('href="/meetings#calendar"')
    expect(duplicate).not.toContain('وصف عام')
  })

  it('keeps a filtered root return and custom root slot visible', async () => {
    currentRoute = { path: '/projects', fullPath: '/projects?mine=1', query: { mine: '1' } }
    const filteredBack = await renderHeader({ title: 'مشاريعي', description: 'وصف عام', backTo: '/projects?mine=1&q=late', backLabel: 'العودة' })
    const html = await renderHeader({ title: 'مشاريعي', description: 'وصف عام' }, {
      back: () => h('a', { href: '/projects?mine=1&q=late' }, 'عودة مخصصة'),
    })

    expect(filteredBack).toContain('href="/projects?mine=1&amp;q=late"')
    expect(html).toContain('href="/projects?mine=1&amp;q=late"')
    expect(html).not.toContain('وصف عام')
  })

  it('keeps one H1 and supplied actions across representative roots', async () => {
    for (const path of ['/projects/dashboard', '/tasks', '/meetings', '/hr', '/account', '/settings/appearance']) {
      currentRoute = { path, fullPath: path, query: {} }
      const html = await renderHeader({ title: 'عنوان الصفحة', description: 'وصف عام', backTo: path }, {
        actions: () => h('button', { type: 'button' }, 'إجراء'),
      })
      expect((html.match(/nasq-page-title/g) ?? []).length).toBe(1)
      expect(html).toContain('إجراء')
      expect(html).not.toContain('وصف عام')
    }
  })
})
