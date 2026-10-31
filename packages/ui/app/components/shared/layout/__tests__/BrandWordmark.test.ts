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
  const useI18n = () => ({ t: (key: string) => ({ 'brand.name': 'نظام ليوان' }[key] ?? key) })
  new Function('require', 'exports', 'ref', 'computed', 'useI18n', code)(require, exports, Vue.ref, Vue.computed, useI18n)
  return exports.default!
}

async function render(props: Record<string, unknown> = {}) {
  const app = Vue.createSSRApp({ render: () => Vue.h(loadWordmark(), props) })
  return renderToString(app)
}

describe('BrandWordmark', () => {
  it('renders the product name and a decorative mark of one path and a diamond', async () => {
    const html = await render()
    expect(html.replace(/<svg[\s\S]*?<\/svg>/, '').replace(/<[^>]+>/g, '').trim()).toBe('نظام ليوان')
    const mark = html.match(/<svg[^>]*data-slot="mark"[^>]*>/)?.[0] ?? ''
    expect(mark).toContain('aria-hidden="true"')
    expect(html.match(/<path /g)).toHaveLength(1)
    expect(html.match(/<rect /g)).toHaveLength(1)
  })

  it('draws the mark with currentColor only, so no colour is fixed in the component', async () => {
    const html = await render()
    expect(html).toContain('stroke="currentColor"')
    expect(html).toContain('fill="currentColor"')
    expect(html).not.toMatch(/#[0-9a-f]{3,6}/i)
  })

  it('takes the heavier stroke below 24px and the regular stroke at lg', async () => {
    for (const size of ['sm', 'md']) {
      const html = await render({ size })
      expect(html).toContain('data-weight="heavy"')
      expect(html).toContain('stroke-width="7.5"')
      expect(html).toContain('viewBox="-2 -2 68 68"')
    }
    for (const size of ['lg', 'xl']) {
      const html = await render({ size })
      expect(html).toContain('data-weight="regular"')
      expect(html).toContain('stroke-width="4.6"')
      expect(html).toContain('viewBox="0 0 64 64"')
    }
  })

  it('draws the mark in the brand colour, and in white when inverted', async () => {
    expect((await render()).match(/<svg[^>]*class="([^"]*)"/)?.[1]).toContain('text-primary')
    expect((await render({ inverted: true })).match(/<svg[^>]*class="([^"]*)"/)?.[1]).toContain('text-white')
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
    ['sm', 'text-sm', 'size-4'],
    ['md', 'text-base', 'size-5'],
    ['lg', 'text-xl', 'size-7'],
    ['xl', 'text-3xl', 'size-10'],
  ])('sizes the %s wordmark and its mark together', async (size, text, mark) => {
    const html = await render({ size })
    expect(html.match(/<span class="([^"]*)"/)?.[1]).toContain(text)
    expect(html.match(/<svg[^>]*class="([^"]*)"/)?.[1]).toContain(mark)
  })

  it('renders the mark alone when markOnly is set', async () => {
    const html = await render({ markOnly: true })
    expect(html.replace(/<svg[\s\S]*?<\/svg>/, '').replace(/<[^>]+>/g, '').trim()).toBe('')
    expect(html.match(/<path /g)).toHaveLength(1)
  })
})
