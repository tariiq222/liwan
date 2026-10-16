import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import * as Vue from 'vue'
import ts from 'typescript'

// Compiles one single-file component of the app with the given auto-imports so a test can run its setup() and render it.
const transpile = (source: string) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText
export const stripImports = (source: string) => source.replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '')
const appRoot = resolve(import.meta.dirname, '../..')
const vueApi = Object.fromEntries(Object.entries(Vue).filter(([key]) => /^[a-z]\w*$/.test(key)))

export function loadSfc(path: string, bindings: Record<string, unknown>) {
  const filename = resolve(appRoot, path)
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
  const script = stripImports(compileScript(descriptor, { id: path }).content).replaceAll('import.meta.client', 'true').replace('export default', 'return')
  const scope = { ...vueApi, _defineComponent: Vue.defineComponent, _useModel: Vue.useModel, _mergeModels: (own: object, models: object) => ({ ...own, ...models }), ...bindings }
  const component = new Function(...Object.keys(scope), transpile(script))(...Object.values(scope))
  const template = compileTemplate({ source: descriptor.template!.content, filename, id: path, compilerOptions: { mode: 'function', expressionPlugins: ['typescript'] } })
  const render = new Function('Vue', transpile(template.code))(Vue)
  const stubs = [...descriptor.template!.content.matchAll(/<([A-Z]\w*)/g)].map(match => match[1]!)
  /** Runs setup() directly (watchers stay live, unlike in a server render) and returns what the template can read. */
  const setup = (props: Record<string, unknown>, emit: (...args: unknown[]) => void = () => {}) => component.setup(Vue.shallowReactive(props), { expose: () => {}, emit, attrs: {}, slots: {} }) as Record<string, any>
  /** Renders to HTML (a plain wrapper exposes the script-setup bindings, as the compiler's own inline mode would); every child component becomes a div carrying its text-like attributes and slots. */
  async function html(props: Record<string, unknown>) {
    const wrapper: Vue.Component = { props: component.props, emits: component.emits, setup: (setupProps: Record<string, unknown>, context: unknown) => ({ ...component.setup(setupProps, context) }), render }
    const app = Vue.createSSRApp(wrapper, props)
    for (const name of new Set(stubs)) app.component(name, Vue.defineComponent({ inheritAttrs: false, setup: (_, { attrs, slots }) => () => Vue.h('div', { 'data-stub': name, 'data-to': typeof attrs.to === 'string' ? attrs.to : attrs.to ? JSON.stringify(attrs.to) : undefined }, [attrs.title as string, attrs.label as string, slots.default?.(), slots.actions?.()]) }))
    return renderToString(app)
  }
  return { setup, html }
}
