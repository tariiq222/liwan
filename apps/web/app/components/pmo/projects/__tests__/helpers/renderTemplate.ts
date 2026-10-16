import { readFileSync } from 'node:fs'
import { compileTemplate, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import ts from 'typescript'
import * as Vue from 'vue'
import { createSSRApp, defineComponent, h, type Component, type RenderFunction } from 'vue'

/** Renders only the template of an SFC with the state its script would compute, so markup is asserted without a browser. */
export async function renderTemplate(filename: string, setupState: Record<string, unknown>, stubs: Record<string, Component> = {}): Promise<string> {
  const parsed = parse(readFileSync(filename, 'utf8'), { filename })
  const compiled = compileTemplate({
    source: parsed.descriptor.template!.content,
    filename,
    id: 'phase-template-test',
    compilerOptions: { mode: 'function', expressionPlugins: ['typescript'] },
  })
  if (compiled.errors.length) throw compiled.errors[0]
  const code = ts.transpileModule(compiled.code, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText
  const render = new Function('Vue', code)(Vue) as RenderFunction
  const app = createSSRApp({ render: () => h(defineComponent({ setup: () => setupState, render })) })
  for (const [name, component] of Object.entries(stubs)) app.component(name, component)
  return renderToString(app)
}
