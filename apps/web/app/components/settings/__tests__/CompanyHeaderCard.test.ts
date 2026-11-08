import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { describe, expect, it } from 'vitest'
import type { CompanyProfile } from '@liwan/contracts'

// The script of the company header card, compiled and run on its own: `facts` is the line under the company name.
function facts(profile: Partial<CompanyProfile>) {
  const filename = new URL('../CompanyHeaderCard.vue', import.meta.url).pathname
  const script = compileScript(parse(readFileSync(filename, 'utf8'), { filename }).descriptor, { id: 'CompanyHeaderCard' }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
  const base = { _defineComponent: Vue.defineComponent, computed: Vue.computed, useI18n: () => ({ t: (key: string) => key }), avatarProps: () => ({}) }
  const code = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText
  const component = new Function(...Object.keys(base), code)(...Object.values(base))
  const full = { id: 1, name: 'ليوان', logo_url: null, company_registry: '1010', vat_registered: true, vat: '300000000000003', completeness: { done: 1, total: 2 }, ...profile }
  return Vue.proxyRefs(Vue.effectScope().run(() => component.setup({ profile: full }, { expose: () => {}, emit: () => {} }))).facts
}

describe('CompanyHeaderCard', () => {
  it('shows the VAT number beside the registry while the company is registered for VAT', () => {
    expect(facts({})).toBe('1010 · 300000000000003')
  })

  it('shows no VAT number for a company that is not registered, even if one is stored', () => {
    expect(facts({ vat_registered: false })).toBe('1010')
  })
})
