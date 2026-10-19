import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import {
  Fragment,
  computed,
  createBlock,
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
  renderList,
  renderSlot,
  resolveComponent,
  toDisplayString,
  unref,
  withCtx,
} from 'vue'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const pageHeaderFile = resolve(import.meta.dirname, '../PageHeader.vue')

const UIconStub = defineComponent({ render: () => h('span', { 'aria-hidden': 'true' }) })
const NuxtLinkStub = defineComponent({
  props: { to: { type: [String, Object], default: '#' } },
  setup(props, { slots }) {
    return () => h('a', { href: typeof props.to === 'string' ? props.to : '#' }, slots.default?.())
  },
})

let frameOwnsHeading = false

function loadPageHeader() {
  const source = readFileSync(pageHeaderFile, 'utf8')
  const descriptor = parse(source, { filename: pageHeaderFile }).descriptor
  const compiled = compileScript(descriptor, { id: 'header-back-rule', inlineTemplate: true }).content
  const script = compiled.replace(/^import .*$/gm, '').replace('export default', 'return')
  const javascript = ts.transpileModule(script, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  }).outputText
  const runtimeBindings = {
    _defineComponent: defineComponent,
    _unref: unref,
    _renderSlot: renderSlot,
    _renderList: renderList,
    _createVNode: createVNode,
    _createTextVNode: createTextVNode,
    _toDisplayString: toDisplayString,
    _resolveComponent: resolveComponent,
    _withCtx: withCtx,
    _openBlock: openBlock,
    _createElementBlock: createElementBlock,
    _createBlock: createBlock,
    _createCommentVNode: createCommentVNode,
    _Fragment: Fragment,
    _createElementVNode: createElementVNode,
  }
  const names = [...Object.keys(runtimeBindings), 'computed', 'usePageHeader', 'useEscapeBack', 'useFrameOwnsHeading', 'usePageTrail', 'useI18n', 'useRoute']
  const values = [
    ...Object.values(runtimeBindings), computed,
    () => undefined,
    () => undefined,
    () => ref(frameOwnsHeading),
    // No published trail in this harness: the page's own target is the whole trail here.
    () => ref([]),
    () => ({ t: (key: string) => key }),
    () => ({ path: '/current' }),
  ]
  return new Function(...names, javascript)(...values)
}

async function renderHeader(props: Record<string, unknown>, slots: Record<string, () => unknown> = {}) {
  const app = createSSRApp({ render: () => h(loadPageHeader(), props, slots) })
  app.config.globalProperties.$t = (key: string) => key
  app.component('NuxtLink', NuxtLinkStub)
  app.component('UButton', NuxtLinkStub)
  app.component('UIcon', UIconStub)
  return renderToString(app)
}

describe('the one back rule in the rendered page header', () => {
  it('renders the back control for any supplied target, whatever the route is', async () => {
    // The suppression list this replaces hid the control on a project section
    // root and on a bare shell-root return. Both now show it, because the page
    // asked for it — there is no second condition left to consult.
    for (const backTo of ['/projects/1/tasks', '/projects', '/meetings', '/projects/1?tab=tasks']) {
      const html = await renderHeader({ title: 'عنوان', backTo, backLabel: 'العودة' })
      expect(html, backTo).toContain(`href="${backTo}"`)
      expect(html, backTo).toContain('العودة')
    }
  })

  it('renders no back control when the page supplies neither a target nor a slot', async () => {
    const html = await renderHeader({ title: 'مهامي', description: 'وصف عام' })
    expect(html).not.toContain('<a href')
    expect(html).toContain('مهامي')
  })

  it('lets a custom back slot stand in for the target', async () => {
    const html = await renderHeader({ title: 'مشاريعي' }, {
      back: () => h('a', { href: '/projects?mine=1&q=late' }, 'عودة مخصصة'),
    })
    expect(html).toContain('عودة مخصصة')
    expect(html).toContain('href="/projects?mine=1&amp;q=late"')
  })

  it('keeps the page description, which the shell no longer repeats', async () => {
    for (const path of ['/projects/1', '/tasks', '/hr/employees/new']) {
      const html = await renderHeader({ title: 'عنوان', description: 'وصف عام', backTo: path })
      expect(html, path).toContain('وصف عام')
    }
  })

  it('is the page H1 outside the project frame', async () => {
    frameOwnsHeading = false
    const html = await renderHeader({ title: 'الموظفون', backTo: '/hr' })
    expect((html.match(/<h1\b/g) ?? []).length).toBe(1)
    expect(html.match(/<h2\b/g)).toBeNull()
    expect(html).toContain('الموظفون')
  })

  it('demotes itself to H2 while the project frame renders the page H1', async () => {
    frameOwnsHeading = true
    try {
      const html = await renderHeader({ title: 'المخاطر', backTo: '/projects/1/governance' })
      expect(html.match(/<h1\b/g), 'the frame owns the only H1 on a project page').toBeNull()
      expect((html.match(/<h2\b/g) ?? []).length).toBe(1)
      expect(html).toContain('المخاطر')
    }
    finally {
      frameOwnsHeading = false
    }
  })

  it('keeps supplied actions alongside the heading', async () => {
    const html = await renderHeader({ title: 'عنوان الصفحة', backTo: '/tasks' }, {
      actions: () => h('button', { type: 'button' }, 'إجراء'),
    })
    expect(html).toContain('إجراء')
  })
})
