import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import ts from 'typescript'
import * as Vue from 'vue'
import { vueBindings } from '../../../../tests/vueBindings'
import { describe, expect, it } from 'vitest'

const filename = resolve(import.meta.dirname, '../AiResolvedLine.vue')
const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
const script = compileScript(descriptor, { id: 'ai-resolved-line' }).content.replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
const js = (source: string) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText
const template = compileTemplate({ source: descriptor.template!.content, filename, id: 'ai-resolved-line', compilerOptions: { mode: 'function', expressionPlugins: ['typescript'] } })
const render = new Function('Vue', js(template.code))(Vue)
const messages: Record<string, string> = { 'ai.confirm.approved': 'تم بعد تأكيدك', 'ai.confirm.rejected': 'أُلغي' }

async function renderLine(state: 'approved' | 'rejected', attrs: Record<string, string> = {}) {
  const bindings = { ...vueBindings, exports: {}, _defineComponent: Vue.defineComponent, useI18n: () => ({ t: (key: string) => messages[key] ?? key }) }
  const component = new Function(...Object.keys(bindings), js(script))(...Object.values(bindings))
  const app = Vue.createSSRApp({ render: () => Vue.h(Vue.defineComponent({ props: ['summary', 'state'], setup: (props: Record<string, unknown>) => ({ ...component.setup(props, { expose: () => {}, emit: () => {} }), props }), render }), { summary: 'سأنجز المهمة', state, ...attrs }) })
  app.component('UIcon', Vue.defineComponent({ props: ['name'], setup: props => () => Vue.h('i', { 'data-icon': props.name }) }))
  return renderToString(app)
}

describe('AiResolvedLine', () => {
  it('shows a check and the approved outcome', async () => {
    const html = await renderLine('approved')
    expect(html).toContain('data-state="approved"')
    expect(html).toContain('data-icon="i-lucide-check"')
    expect(html).toContain('سأنجز المهمة — تم بعد تأكيدك')
  })

  it('shows a cross and the rejected outcome', async () => {
    const html = await renderLine('rejected')
    expect(html).toContain('data-state="rejected"')
    expect(html).toContain('data-icon="i-lucide-x"')
    expect(html).toContain('سأنجز المهمة — أُلغي')
  })

  it('passes the caller test id to its root', async () => {
    expect(await renderLine('approved', { 'data-testid': 'ai-draft' })).toContain('data-testid="ai-draft"')
  })
})
