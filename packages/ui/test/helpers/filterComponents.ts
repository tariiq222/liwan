import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import ts from 'typescript'
import * as Vue from 'vue'

import { sharedFile } from './renderShared'

export function loadFilterComponent(name: string, hydrated = true): Vue.Component {
  const filename = sharedFile(name)
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
  const compiled = compileScript(descriptor, { id: name, inlineTemplate: true }).content
  const code = ts.transpileModule(compiled, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText
  const exports: { default?: Vue.Component } = {}
  const require = (path: string) => {
    if (path === 'vue') return Vue
    throw new Error(`Unhandled component dependency ${path}`)
  }
  new Function('require', 'exports', 'ref', 'computed', 'useId', 'useI18n', 'useHydrated', code)(require, exports, Vue.ref, Vue.computed, Vue.useId, () => ({ t: (key: string) => ({ 'filterCard.title': 'Search and filters', 'filterCard.clear': 'Clear filters' }[key] ?? key) }), () => Vue.ref(hydrated))
  return exports.default!
}
export async function renderFilter(name: string, props: Record<string, unknown> = {}, slots: Record<string, () => Vue.VNode | Vue.VNode[]> = {}, hydrated = true) {
  const app = Vue.createSSRApp({ render: () => Vue.h(loadFilterComponent(name, hydrated), props, slots) })
  for (const [name, tag] of Object.entries({ UButton: 'button', UBadge: 'span' })) {
    app.component(name, Vue.defineComponent({ setup(_, { attrs, slots }) { return () => Vue.h(tag, attrs, slots.default?.()) } }))
  }
  app.component('UPopover', Vue.defineComponent({
    inheritAttrs: false,
    setup(_, { slots }) { return () => Vue.h('div', [slots.default?.(), slots.content?.()]) },
  }))
  return renderToString(app)
}
