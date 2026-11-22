import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import * as Vue from 'vue'
import ts from 'typescript'
import { vi } from 'vitest'

// Mounts a page's SFC in place: the script and template are compiled, every Nuxt/UI binding the page resolves is
// injected, and each child component is a shallow stub that records the props and listeners it was given.
const transpile = (source: string) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText
const stripImports = (source: string) => source.replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '')

export type Captured = { name: string, props: Record<string, any> }
export type AsyncDataCall = { key: () => string, refresh: ReturnType<typeof vi.fn>, data: Vue.Ref<unknown>, error: Vue.Ref<unknown> }
export type PageOptions = {
  /** Replaces `import.meta.client` in the page's script. */
  client?: boolean
  /** The answer of one `useAsyncData` handler, by the position of the call; the default calls the page's own fetcher. */
  failures?: Record<number, unknown>
}

export async function mountPage(path: string, bindings: Record<string, unknown>, options: PageOptions = {}) {
  const filename = resolve(import.meta.dirname, '..', path)
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
  const script = stripImports(compileScript(descriptor, { id: path }).content).replaceAll('import.meta.client', String(options.client ?? false)).replace('export default', 'return')
  const unmounts: (() => void)[] = []
  const asyncData: AsyncDataCall[] = []
  const all = {
    _defineComponent: Vue.defineComponent, _withAsyncContext: (fn: () => unknown) => [fn(), () => {}],
    computed: Vue.computed, ref: Vue.ref, watch: Vue.watch, reactive: Vue.reactive, nextTick: Vue.nextTick, watchEffect: Vue.watchEffect,
    onMounted: (fn: () => void) => { if (options.client) fn() }, onBeforeUnmount: (fn: () => void) => { unmounts.push(fn) },
    definePageMeta: () => {}, useHydrated: () => Vue.ref(true),
    useI18n: () => ({ t: (key: string) => key, locale: Vue.ref('en') }),
    useAsyncData: async (key: string | (() => string), fn: () => Promise<unknown>) => {
      const data = Vue.ref<unknown>(null); const error = Vue.ref<unknown>(null); const pending = Vue.ref(false)
      const index = asyncData.length
      const refresh = vi.fn(async () => {
        pending.value = true
        try {
          if (index in (options.failures ?? {}) && options.failures![index] !== undefined) throw options.failures![index]
          data.value = await fn(); error.value = null
        } catch (cause) { error.value = cause } finally { pending.value = false }
      })
      asyncData.push({ key: typeof key === 'function' ? key : () => key, refresh, data, error })
      await refresh(); refresh.mockClear()
      return { data, error, pending, refresh }
    },
    ...bindings,
  }
  const component = new Function(...Object.keys(all), transpile(script))(...Object.values(all))
  const scope = Vue.effectScope()
  const state = await scope.run(() => component.setup({}, { expose: () => {} }))
  const template = compileTemplate({ source: descriptor.template!.content, filename, id: path, compilerOptions: { mode: 'function', expressionPlugins: ['typescript'] } })
  const render = new Function('Vue', transpile(template.code))(Vue)
  async function rendered() {
    const captured: Captured[] = []
    const app = Vue.createSSRApp(Vue.defineComponent({ setup: () => Object.fromEntries(Object.entries(state).filter(([key]) => !key.startsWith('$'))), render }))
    for (const name of new Set([...descriptor.template!.content.matchAll(/<([A-Z]\w*)/g)].map(match => match[1]!))) app.component(name, Vue.defineComponent({ inheritAttrs: false, setup(_, { attrs, slots }) {
      return () => { captured.push({ name, props: { ...attrs } }); return Vue.h('div', [slots.default?.(), slots.filters?.(), slots.search?.(), slots.header?.(), slots.actions?.()]) }
    } }))
    return { html: await renderToString(app), captured }
  }
  return { state, asyncData, unmounts, rendered, stop: () => scope.stop() }
}
