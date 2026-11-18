import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'

const filename = new URL('../InboxPresets.vue', import.meta.url).pathname

function mountPresets() {
  const script = compileScript(parse(readFileSync(filename, 'utf8'), { filename }).descriptor, { id: 'inbox-presets' }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
  const apply = vi.fn((_key: string, options: { onSuccess: () => void }) => options.onSuccess())
  const add = vi.fn()
  const bindings = {
    _defineComponent: Vue.defineComponent, _unref: Vue.unref, ref: Vue.ref,
    useI18n: () => ({ t: (key: string) => key }), useHydrated: () => Vue.ref(true), useToast: () => ({ add }),
    useApplyInboxPreset: () => ({ mutate: apply, isPending: Vue.ref(false) }),
    InboxPresetKeySchema: { options: ['clinic', 'store', 'public_service'] },
  }
  const code = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText
  const component = new Function(...Object.keys(bindings), code)(...Object.values(bindings))
  const state = Vue.effectScope().run(() => component.setup({}, { expose: () => {}, emit: () => {} }))
  return { state: Vue.proxyRefs(state), apply, add }
}

describe('InboxPresets', () => {
  it('shows no details until a card asks, and applying stays behind its own confirmation', () => {
    const { state, apply } = mountPresets()
    expect([state.detailed, state.asking]).toEqual([null, null])
    state.detailed = 'store'
    expect(apply).not.toHaveBeenCalled()
    state.asking = 'clinic'
    state.applyAsked()
    expect(apply).toHaveBeenCalledExactlyOnceWith('clinic', expect.any(Object))
    expect(state.asking).toBeNull()
    expect(state.detailed).toBe('store')
  })
})
