import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import { renderToString } from 'vue/server-renderer'
import ts from 'typescript'
import * as Vue from 'vue'
import { describe, expect, it } from 'vitest'
import type { PayableInvoice } from '@liwan/contracts'
import * as pay from '../../../composables/paymentPay'

// The summary component compiled with its template and rendered on the server, with the shared pieces stubbed to plain rows.
async function render(payable: PayableInvoice) {
  const filename = new URL('../PayDocumentSummary.vue', import.meta.url).pathname
  const script = compileScript(parse(readFileSync(filename, 'utf8'), { filename }).descriptor, { id: 'PayDocumentSummary', inlineTemplate: true }).content
    .replace(/^import\s*\{([^}]*)\}\s*from\s*['"]vue['"];?\s*$/gm, (_, names: string) => `const {${names.replace(/ as /g, ': ')}} = Vue`)
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
  const base = { Vue, computed: Vue.computed, useHydrated: () => Vue.ref(true), useI18n: () => ({ t: (key: string) => key, locale: Vue.ref('en') }), ...pay }
  const code = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText
  const component = new Function(...Object.keys(base), code)(...Object.values(base))
  const row = Vue.defineComponent({ props: { label: { type: String, default: '' }, value: { type: String, default: null } }, setup: (props, { slots }) => () => Vue.h('div', [props.label, props.value, slots.default?.()]) })
  const app = Vue.createSSRApp(component, { kind: 'invoice', payable })
  app.component('SharedSubCard', Vue.defineComponent({ setup: (_, { slots }) => () => Vue.h('div', slots.default?.()) })).component('SharedPropertyRow', row)
  return renderToString(app)
}

const invoice: PayableInvoice = { id: 2, merchant: 'ليوان', number: 'INV/2026/0002', due_date: '2026-10-31', currency: 'SAR', amount_untaxed: 14700, amount_tax: 2205, amount_total: 16905, tax_applies: true, amount_due: 16905, status: 'payable', options: [] }
// An unregistered company's document: no tax, and the server says tax does not apply.
const untaxed: PayableInvoice = { ...invoice, amount_untaxed: 16905, amount_tax: 0, tax_applies: false }

describe('PayDocumentSummary', () => {
  it('shows no total, untaxed or tax row for an untaxed document that is fully due', async () => {
    const html = await render(untaxed)
    expect(html).not.toContain('pay-total')
    expect(html).not.toContain('pay-untaxed')
    expect(html).not.toContain('pay-tax')
  })

  it('still shows the document total of an untaxed document paid in part', async () => {
    const html = await render({ ...untaxed, amount_due: 3000, amount_total: 8000 })
    expect(html).toContain('pay-total')
    expect(html).toContain('8,000.00')
    expect(html).not.toContain('pay-untaxed')
    expect(html).not.toContain('pay-tax')
  })

  it('shows the untaxed amount, the tax and the total of a taxed document paid in part', async () => {
    const html = await render({ ...invoice, amount_due: 3000 })
    expect(html).toContain('pay-untaxed')
    expect(html).toContain('pay-tax')
    expect(html).toContain('pay-total')
  })

  it('shows the untaxed amount and the tax but no total when a taxed document is fully due', async () => {
    const html = await render(invoice)
    expect(html).toContain('pay-untaxed')
    expect(html).toContain('pay-tax')
    expect(html).not.toContain('pay-total')
  })

  it('shows the tax rows at zero for a registered company whose document is zero-rated', async () => {
    const html = await render({ ...invoice, amount_untaxed: 16905, amount_tax: 0 })
    expect(html).toContain('pay-untaxed')
    expect(html).toContain('pay-tax')
  })

  it('keeps the tax rows of an older taxed document after the company stopped being registered', async () => {
    // The server answers tax_applies true because the document itself carries tax.
    const html = await render({ ...invoice, tax_applies: true })
    expect(html).toContain('pay-untaxed')
    expect(html).toContain('pay-tax')
  })

  it('follows tax_applies, not the tax amount, so a false flag hides the rows', async () => {
    const html = await render({ ...invoice, tax_applies: false })
    expect(html).not.toContain('pay-untaxed')
    expect(html).not.toContain('pay-tax')
  })
})
