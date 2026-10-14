import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileScript, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import ts from 'typescript'
import * as Vue from 'vue'
import { describe, expect, it } from 'vitest'

const filename = resolve(dirname(fileURLToPath(import.meta.url)), '../BrandWordmark.vue')

// Compiles the SFC and stubs the Nuxt auto-import `useI18n`, as the sibling tests do.
function loadWordmark(): Vue.Component {
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
  const compiled = compileScript(descriptor, { id: 'BrandWordmark', inlineTemplate: true }).content
  const code = ts.transpileModule(compiled, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText
  const exports: { default?: Vue.Component } = {}
  const require = (path: string) => {
    if (path === 'vue') return Vue
    throw new Error(`Unhandled component dependency ${path}`)
  }
  const useI18n = () => ({ t: (key: string) => ({ 'brand.name': 'نَسَق' }[key] ?? key) })
  new Function('require', 'exports', 'ref', 'computed', 'useI18n', code)(require, exports, Vue.ref, Vue.computed, useI18n)
  return exports.default!
}

async function render(props: Record<string, unknown> = {}) {
  const app = Vue.createSSRApp({ render: () => Vue.h(loadWordmark(), props) })
  return renderToString(app)
}

describe('BrandWordmark', () => {
  it('renders the product name and a decorative lime dot', async () => {
    const html = await render()
    expect(html.replace(/<[^>]+>/g, '').trim()).toBe('نَسَق')
    const dot = html.match(/<span[^>]*data-slot="dot"[^>]*>/)?.[0] ?? ''
    expect(dot).toContain('aria-hidden="true"')
    expect(dot).toContain('bg-nasq-lime')
  })

  it('uses white text when inverted', async () => {
    const html = await render({ inverted: true })
    const root = html.match(/<span class="([^"]*)"/)?.[1] ?? ''
    expect(root).toContain('text-white')
  })

  it('uses highlighted text when not inverted', async () => {
    const root = (await render()).match(/<span class="([^"]*)"/)?.[1] ?? ''
    expect(root).toContain('text-highlighted')
    expect(root).not.toContain('text-white')
  })

  it.each([
    ['sm', 'text-sm', 'size-1.5'],
    ['md', 'text-base', 'size-2'],
    ['lg', 'text-xl', 'size-2.5'],
  ])('sizes the %s wordmark and its dot together', async (size, text, dot) => {
    const html = await render({ size })
    expect(html.match(/<span class="([^"]*)"/)?.[1]).toContain(text)
    expect(html.match(/<span[^>]*data-slot="dot"[^>]*>/)?.[0]).toContain(dot)
  })
})
