import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { InboxCatalogCreateSchema } from '@liwan/contracts'

// The script of the catalog connect form, compiled and run against stubbed queries (as the other component tests do).
function run() {
  const filename = new URL('../InboxCatalogConnectForm.vue', import.meta.url).pathname
  const script = compileScript(parse(readFileSync(filename, 'utf8'), { filename }).descriptor, { id: 'InboxCatalogConnectForm' }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
  const create = vi.fn(async (body: unknown) => ({ id: 1, ...(body as object) }))
  const base = {
    _defineComponent: Vue.defineComponent, InboxCatalogCreateSchema, ref: Vue.ref, computed: Vue.computed,
    useCreateInboxCatalog: () => ({ mutateAsync: create, isPending: Vue.ref(false) }),
    useInboxChannels: () => ({ data: Vue.ref({ items: [] }) }),
    useI18n: () => ({ t: (key: string) => key }), useHydrated: () => Vue.ref(true), useToast: () => ({ add: vi.fn() }),
  }
  const code = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText
  const component = new Function(...Object.keys(base), code)(...Object.values(base))
  const state = Vue.proxyRefs(Vue.effectScope().run(() => component.setup({ backTo: '/back' }, { expose: () => {}, emit: () => {} })))
  state.channelId = 3
  state.metaCatalogId = '123456789'
  state.brand = 'ليوان'
  return { state, create }
}

describe('InboxCatalogConnectForm', () => {
  it('sends the catalog defaults and no tax preference, which belongs to the establishment settings', async () => {
    const { state, create } = run()
    await state.submit()
    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.lastCall?.[0]).toEqual({ channel_id: 3, meta_catalog_id: '123456789', connect: true, brand: 'ليوان', default_link: null })
  })
})
