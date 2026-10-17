import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import ts from 'typescript'
import * as Vue from 'vue'
import { createSSRApp, defineComponent, h } from 'vue'
import { describe, expect, it } from 'vitest'

const filename = resolve(import.meta.dirname, '../PendingCharterReviews.vue')
const arProjects = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../../../../i18n/locales/ar/projects.json'), 'utf8'))

const Stub = (tag: string) => defineComponent({
  inheritAttrs: false,
  props: { to: { type: String, default: undefined }, title: { type: String, default: undefined }, label: { type: String, default: undefined } },
  setup: (props, { slots, attrs }) => () => h(tag, { ...attrs, href: props.to }, [props.title, props.label, slots.actions?.(), slots.default?.()]),
})

async function render(list: { data?: unknown; error?: unknown }) {
  const { descriptor } = parse(readFileSync(filename, 'utf8'), { filename })
  const compiledScript = compileScript(descriptor, { id: 'pending-charters', inlineTemplate: false })
  const script = compiledScript.content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '')
    .replace('export default', 'return')
  const setupCode = ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText
  const bindings = {
    _defineComponent: Vue.defineComponent, computed: Vue.computed, ref: Vue.ref,
    useI18n: () => ({ t: (key: string) => key.split('.').reduce((node: any, part) => node?.[part], arProjects) ?? key }),
    useProjectList: () => ({ data: Vue.ref(list.data), error: Vue.ref(list.error ?? null), refetch: () => {} }),
  }
  const component = new Function(...Object.keys(bindings), setupCode)(...Object.values(bindings))
  const compiled = compileTemplate({ source: descriptor.template!.content, filename, id: 'pending-charters', compilerOptions: { mode: 'function', bindingMetadata: compiledScript.bindings, prefixIdentifiers: true } })
  const renderFn = new Function('Vue', ts.transpileModule(compiled.code, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText)(Vue)
  const app = createSSRApp(defineComponent({ ...component, render: renderFn }))
  app.component('SharedRecordSection', Stub('section'))
  app.component('UBadge', Stub('span'))
  app.component('UButton', Stub('a'))
  app.component('SharedErrorState', defineComponent({ setup: (_, { attrs }) => () => h('div', attrs, 'error') }))
  app.config.warnHandler = () => {}
  return renderToString(app)
}

describe('PendingCharterReviews', () => {
  it('renders nothing when no charter waits for the caller', async () => {
    expect(await render({ data: { items: [], total: 0 } })).not.toContain('pending-charters')
  })

  it('renders nothing while the list is loading', async () => {
    expect(await render({})).not.toContain('pending-charters')
  })

  it('renders one link per project to its charter', async () => {
    const html = await render({ data: { items: [{ id: 7, name: 'ألفا' }, { id: 9, name: 'بيتا' }], total: 2 } })
    expect(html).toContain('مواثيق بانتظار اعتمادك')
    expect(html).toContain('مراجعة الميثاق')
    expect(html).toContain('data-testid="pending-charters-count"')
    expect(html.match(/data-testid="pending-charter-link"/g)).toHaveLength(2)
    expect(html).toContain('href="/projects/7/charter"')
    expect(html).toContain('href="/projects/9/charter"')
  })

  it('shows the error state when the list fails', async () => {
    expect(await render({ error: new Error('x') })).toContain('pending-charters-error')
  })
})
