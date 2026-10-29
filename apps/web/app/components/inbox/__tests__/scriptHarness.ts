import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'

// Runs a component's <script setup> against stubbed composables, as the other inbox component tests do: the imports are
// dropped, the names they brought in come from `bindings`, and `setup` is called with reactive props. The template is
// not rendered; what is asserted is the state and the behaviour the script exposes.
export function mountScript(file: URL, bindings: Record<string, unknown>, props: Record<string, unknown>) {
  const filename = file.pathname
  const script = compileScript(parse(readFileSync(filename, 'utf8'), { filename }).descriptor, { id: filename }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
  const emitted: Array<[string, unknown]> = []
  const reactiveProps = Vue.reactive(props) as Record<string, unknown>
  const emit = (name: string, value: unknown) => {
    emitted.push([name, value])
    if (name.startsWith('update:')) reactiveProps[name.slice(7)] = value
  }
  // defineModel needs a component instance; here a model reads its prop and writes by emitting `update:<name>`.
  const useModel = (modelProps: Record<string, unknown>, name: string) => Vue.computed({ get: () => modelProps[name], set: (value: unknown) => emit(`update:${name}`, value) })
  // Only the names a function parameter can take (the CommonJS build also exports `module.exports` and `default`).
  const vue = Object.fromEntries(Object.entries(Vue).filter(([name]) => /^[A-Za-z_$][\w$]*$/.test(name) && name !== 'default'))
  const all = {
    ...vue, _defineComponent: Vue.defineComponent, _unref: Vue.unref, _useModel: useModel, _mergeModels: vue.mergeModels,
    useI18n: () => ({ t: (key: string, values?: Record<string, unknown>) => (values ? `${key} ${JSON.stringify(values)}` : key), locale: Vue.ref('ar') }),
    useHydrated: () => Vue.ref(true), useToast: () => ({ add: () => {} }), useAccess: () => ({ can: () => true }), ...bindings,
  }
  const code = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText
  const component = new Function(...Object.keys(all), code)(...Object.values(all))
  const scope = Vue.effectScope()
  const state = Vue.proxyRefs(scope.run(() => component.setup(reactiveProps, { expose: () => {}, emit })))
  return { state, props: reactiveProps, emitted, stop: () => scope.stop() }
}
