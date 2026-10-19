import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileScript, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import ts from 'typescript'
import * as Vue from 'vue'

const sharedRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../app/components/shared')
/** The shared component groups (components/shared/<group>/<name>.vue). */
const SHARED_GROUPS = ['layout', 'data', 'form', 'feedback']

/** Path of packages/ui/app/components/shared/<group>/<name>.vue; `name` may also be an absolute path to a component outside the layer. */
export function sharedFile(name: string): string {
  if (isAbsolute(name)) return name
  const grouped = SHARED_GROUPS.map(group => resolve(sharedRoot, group, `${name}.vue`)).find(existsSync)
  return grouped ?? resolve(sharedRoot, `${name}.vue`)
}

export interface SharedRenderOptions {
  hydrated?: boolean
  /** Translations by key; a missing key renders as the key itself. `{name}` params are filled. */
  messages?: Record<string, string>
  /** The route path the component sees; the trail drops a step that links to it. */
  routePath?: string
  /** Further Nuxt auto-imports the component calls (useRoute, useRouter, …). */
  globals?: Record<string, unknown>
  /** Modules the component imports, by specifier (for example '../../../utils/errorState'). */
  modules?: Record<string, unknown>
  /** Component stubs by tag, over the defaults below. */
  stubs?: Record<string, Vue.Component>
}

export function fakeT(messages: Record<string, string> = {}) {
  return (key: string, params: Record<string, unknown> = {}) =>
    (messages[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`))
}

const passthrough = (tag: string) => Vue.defineComponent({
  inheritAttrs: false,
  setup(_, { attrs, slots }) { return () => Vue.h(tag, attrs, slots.default?.()) },
})

/** Default stand-ins for the Nuxt UI primitives the shared components render. */
export const DEFAULT_STUBS: Record<string, Vue.Component> = {
  UButton: Vue.defineComponent({
    inheritAttrs: false,
    setup(_, { attrs, slots }) {
      return () => attrs.to
        ? Vue.h('a', { ...attrs, href: typeof attrs.to === 'string' ? attrs.to : '#' }, slots.default?.())
        : Vue.h('button', attrs, slots.default?.())
    },
  }),
  UAlert: Vue.defineComponent({
    inheritAttrs: false,
    props: { title: String, description: String },
    setup(props, { attrs, slots }) {
      return () => Vue.h('div', attrs, [Vue.h('p', props.title), props.description ? Vue.h('p', props.description) : null, slots.actions?.()])
    },
  }),
  UBadge: passthrough('span'),
  UIcon: passthrough('span'),
  USkeleton: passthrough('div'),
  UCard: Vue.defineComponent({
    inheritAttrs: false,
    setup(_, { attrs, slots }) { return () => Vue.h('section', attrs, [slots.header?.(), slots.default?.(), slots.footer?.()]) },
  }),
  NuxtLink: passthrough('a'),
}

/** Compiles packages/ui/app/components/shared/<group>/<name>.vue with Nuxt's auto-imports stubbed, as the sibling tests do. */
export function loadShared(name: string, options: SharedRenderOptions = {}): Vue.Component {
  const filename = sharedFile(name)
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
  const compiled = compileScript(descriptor, { id: `shared-${name}`, inlineTemplate: true }).content
  const code = ts.transpileModule(compiled, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText
  const exports: { default?: Vue.Component } = {}
  const require = (specifier: string): unknown => {
    if (specifier === 'vue') return Vue
    if (options.modules && specifier in options.modules) return options.modules[specifier]
    const sibling = specifier.match(/^(?:\.\/|\.\.\/\w+\/|@\/components\/shared\/(?:\w+\/)?)([\w.]+)\.vue$/)
    if (sibling) return { __esModule: true, default: loadShared(sibling[1]!, options) }
    throw new Error(`${name}.vue imports ${specifier}; pass it in options.modules`)
  }
  const t = fakeT(options.messages)
  const autoImports: Record<string, unknown> = {
    ref: Vue.ref, computed: Vue.computed, watch: Vue.watch, shallowRef: Vue.shallowRef, nextTick: Vue.nextTick,
    toRef: Vue.toRef, provide: Vue.provide, inject: Vue.inject, useId: Vue.useId, useSlots: Vue.useSlots, onMounted: Vue.onMounted, onBeforeUnmount: Vue.onBeforeUnmount,
    useI18n: () => ({ t, locale: Vue.ref('ar'), localeProperties: Vue.ref({ dir: 'rtl' }) }),
    useHydrated: () => Vue.ref(options.hydrated ?? true),
    useRoute: () => ({ path: options.routePath ?? '/current' }),
    // Outside a shell there is no published trail; a test that wants one passes it in `globals`.
    usePageTrail: () => Vue.readonly(Vue.ref([])),
    usePageAccent: () => Vue.readonly(Vue.ref(null)),
    ...options.globals,
  }
  new Function('require', 'exports', ...Object.keys(autoImports), code)(require, exports, ...Object.values(autoImports))
  return exports.default!
}

export async function renderShared(
  name: string,
  props: Record<string, unknown> = {},
  slots: Record<string, () => Vue.VNode | Vue.VNode[]> = {},
  options: SharedRenderOptions = {},
): Promise<string> {
  const app = Vue.createSSRApp({ render: () => Vue.h(loadShared(name, options), props, slots) })
  app.config.globalProperties.$t = fakeT(options.messages) as never
  for (const [tag, component] of Object.entries({ ...DEFAULT_STUBS, ...options.stubs })) app.component(tag, component)
  return renderToString(app)
}
