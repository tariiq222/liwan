import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import ts from 'typescript'
import * as Vue from 'vue'
import { describe, expect, it } from 'vitest'

const filename = resolve(import.meta.dirname, '../RecordNumber.vue')
const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
const compiled = compileScript(descriptor, { id: 'record-number', inlineTemplate: true }).content
const code = ts.transpileModule(compiled, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText
const exports: { default?: Vue.Component } = {}
new Function('require', 'exports', 'computed', code)((name: string) => {
  if (name !== 'vue') throw new Error(`Unexpected dependency ${name}`)
  return Vue
}, exports, Vue.computed)
const component = exports.default!
const render = (value?: string | number | null) => renderToString(Vue.createSSRApp({ render: () => Vue.h(component, { value }) }))

describe('record number presentation', () => {
  it('preserves a business reference and isolates its left-to-right order', async () => {
    const html = await render('MIN/2026/0680')
    expect(html).toContain('<bdi')
    expect(html).toContain('dir="ltr"')
    expect(html).toContain('tabular-nums')
    expect(html).not.toContain('font-mono')
    expect(html).toContain('>MIN/2026/0680</bdi>')
  })
  it('renders the stable numeric id without a row index or invented prefix', async () => {
    expect(await render(12)).toContain('>12</bdi>')
  })
  it('preserves zero and leading zeros when the identifier is a string', async () => {
    expect(await render(0)).toContain('>0</bdi>')
    expect(await render('0012')).toContain('>0012</bdi>')
  })
  it('uses a missing-value marker without inventing an identifier', async () => {
    for (const value of [undefined, null, '', ' ', Number.NaN]) expect(await render(value)).toContain('>—</bdi>')
  })
  it('escapes reference content rather than interpreting it as markup', async () => {
    const html = await render('<b>12</b>')
    expect(html).toContain('&lt;b&gt;12&lt;/b&gt;')
    expect(html).not.toContain('<b>12</b>')
  })
})
