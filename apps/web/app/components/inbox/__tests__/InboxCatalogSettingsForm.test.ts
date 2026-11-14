import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { InboxCatalogPatchSchema, type InboxCatalog } from '@liwan/contracts'

// The script of the catalog defaults form, compiled and run against a stubbed patch mutation (as the other component tests do).
function run(catalog: InboxCatalog) {
  const filename = new URL('../InboxCatalogSettingsForm.vue', import.meta.url).pathname
  const script = compileScript(parse(readFileSync(filename, 'utf8'), { filename }).descriptor, { id: 'InboxCatalogSettingsForm' }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
  const mutate = vi.fn()
  const base = {
    _defineComponent: Vue.defineComponent, InboxCatalogPatchSchema, usePatchInboxCatalog: () => ({ mutate, isPending: Vue.ref(false) }),
    ref: Vue.ref, computed: Vue.computed, watch: Vue.watch, useI18n: () => ({ t: (key: string) => key }), useHydrated: () => Vue.ref(true), useToast: () => ({ add: vi.fn() }),
  }
  const code = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText
  const component = new Function(...Object.keys(base), code)(...Object.values(base))
  const state = Vue.proxyRefs(Vue.effectScope().run(() => component.setup(Vue.reactive({ catalog, manage: true }), { expose: () => {}, emit: () => {} })))
  return { state, mutate }
}

const catalog = (overrides: Partial<InboxCatalog> = {}): InboxCatalog => ({
  id: 1, brand: 'ليوان', default_link: null, ...overrides,
} as InboxCatalog)

describe('InboxCatalogSettingsForm', () => {
  it('sends the brand and the product link, with no tax preference', () => {
    const { state, mutate } = run(catalog())
    state.brand = 'علامة جديدة'
    state.save()
    expect(mutate.mock.lastCall?.[0]).toEqual({ brand: 'علامة جديدة', default_link: null })
  })

  it('saves nothing while the defaults are unchanged', () => {
    const { state, mutate } = run(catalog())
    expect(state.dirty).toBe(false)
    state.save()
    expect(mutate).not.toHaveBeenCalled()
  })
})
