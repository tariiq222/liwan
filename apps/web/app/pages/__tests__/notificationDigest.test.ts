import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileTemplate, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import ts from 'typescript'
import * as Vue from 'vue'
import { createSSRApp, defineComponent, h, type RenderFunction } from 'vue'
import { describe, expect, it } from 'vitest'
import { safeReturnTo } from '../../utils/safeReturnTo'

const filename = resolve(dirname(fileURLToPath(import.meta.url)), '../notification-digests/[id].vue')
const source = readFileSync(filename, 'utf8')

const Passthrough = defineComponent({
  inheritAttrs: false,
  setup(_, { slots, attrs }) {
    return () => h('div', attrs, [slots.back?.(), slots.actions?.(), slots.default?.()])
  },
})

function loadPage(setup: () => Record<string, unknown>) {
  const parsed = parse(source, { filename })
  if (!parsed.descriptor.template) throw new Error('no template')
  const compiled = compileTemplate({
    source: parsed.descriptor.template.content,
    filename,
    id: 'digest-page',
    compilerOptions: { mode: 'function', expressionPlugins: ['typescript'] },
  })
  const runnableCode = ts.transpileModule(compiled.code, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  }).outputText
  const render = new Function('Vue', runnableCode)(Vue) as RenderFunction
  return defineComponent({ setup, render })
}

async function renderPage(setup: () => Record<string, unknown>) {
  const app = createSSRApp({ render: () => h(loadPage(setup)) })
  app.component('Button', Passthrough)
  app.component('SharedPageContainer', Passthrough)
  app.component('SharedPageHeader', Passthrough)
  app.component('ArrowLeft', defineComponent({ setup: () => () => null }))
  app.component('ArrowRight', defineComponent({ setup: () => () => null }))
  return renderToString(app)
}

const t = (key: string) => key

describe('notification digest page production template', () => {
  it('uses safeReturnTo for back and allows only internal digest/task prefixes', () => {
    expect(source).toContain('safeReturnTo')
    expect(source).toContain("['/notifications', '/notification-digests']")
    expect(source).toContain('route.fullPath')
    expect(safeReturnTo('/notification-digests/3', '/notifications', ['/notifications', '/notification-digests'])).toBe('/notification-digests/3')
    expect(safeReturnTo('/evil', '/notifications', ['/notifications', '/notification-digests'])).toBe('/notifications')
  })

  it('shows invalid id as an error, not an empty list', async () => {
    const html = await renderPage(() => ({
      t, hydrated: true, isRtl: false, idInvalid: true, isError: false, isLoading: false,
      items: [], overdueCount: 0, queryErrorMessage: 'err', isFetchNextPageError: false,
      hasNextPage: false, isFetching: false, isFetchingNextPage: false,
      ArrowLeft: 'span', ArrowRight: 'span',
      goBack: () => {}, retryDigest: () => {}, retryNextPage: () => {}, openTask: () => {},
    }))
    expect(html).toContain('data-testid="digest-invalid"')
    expect(html).toContain('tasks.digest.invalid')
    expect(html).not.toContain('data-testid="digest-empty"')
  })

  it('preserves first-page rows when the next page fails and offers retry', async () => {
    const html = await renderPage(() => ({
      t, hydrated: false, isRtl: false, idInvalid: false, isError: false, isLoading: false,
      items: [{ id: 9, name: 'Overdue A', project: { name: 'P' } }],
      overdueCount: 2, queryErrorMessage: 'err', isFetchNextPageError: true,
      hasNextPage: true, isFetching: false, isFetchingNextPage: false,
      ArrowLeft: 'span', ArrowRight: 'span',
      goBack: () => {}, retryDigest: () => {}, retryNextPage: () => {}, openTask: () => {},
    }))
    expect(html).toContain('Overdue A')
    expect(html).toContain('data-testid="digest-next-error"')
    expect(html).toContain('data-testid="digest-retry-page"')
    expect(html).toContain('data-testid="digest-back"')
    expect(html).toContain('disabled')
  })

  it('catches fetchNextPage rejection in production source', () => {
    expect(source).toContain('await fetchNextPage()')
    expect(source).toContain('catch')
  })
})
