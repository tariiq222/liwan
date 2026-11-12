import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { vi } from 'vitest'

/** Runs one component's setup with its imports and auto-imports replaced by the bindings given; returns the setup state and the emit spy. */
export function setupSfc(filename: string, props: Record<string, unknown>, bindings: Record<string, unknown>) {
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
  const code = compileScript(descriptor, { id: 'sfc' }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '')
    .replace('export default', 'return')
  const all = {
    _defineComponent: Vue.defineComponent, ref: Vue.ref, computed: Vue.computed, watch: Vue.watch, nextTick: Vue.nextTick,
    useI18n: () => ({ t: (key: string) => key, locale: Vue.ref('en') }), useHydrated: () => Vue.ref(true), ...bindings,
  }
  const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText
  const component = new Function(...Object.keys(all), js)(...Object.values(all))
  const emit = vi.fn()
  return { state: component.setup(Vue.reactive(props), { expose: () => {}, emit }), emit }
}

/** The pending-aware stand-in of a vue-query mutation. */
export const mutation = (mutateAsync: (...args: any[]) => Promise<unknown>) => ({ mutateAsync, isPending: Vue.ref(false) })
