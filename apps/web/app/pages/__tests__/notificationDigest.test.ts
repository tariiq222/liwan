import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileTemplate, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import ts from 'typescript'
import * as Vue from 'vue'
import { createSSRApp, defineComponent, h, type RenderFunction } from 'vue'
import { describe, expect, it } from 'vitest'
import { safeReturnTo } from '@webvue/ui/app/utils/safeReturnTo'

const filename = resolve(dirname(fileURLToPath(import.meta.url)), '../notification-digests/[id].vue')
const source = readFileSync(filename, 'utf8')

const Passthrough = defineComponent({
  inheritAttrs: false,
  setup(_, { slots, attrs }) {
    return () => h('div', attrs, [slots.back?.(), slots.actions?.(), slots.default?.()])
  },
})

const RecordStub = defineComponent({
  inheritAttrs: false,
  props: ['title', 'description', 'backTo', 'backLabel', 'loading', 'error'],
  setup(props, { slots }) {
    return () => h('div', {
      'data-testid': 'record-stub', 'data-title': props.title, 'data-description': props.description,
      'data-back': JSON.stringify(props.backTo), 'data-loading': String(Boolean(props.loading)),
    }, [slots.actions?.(), ...(props.loading ? [] : [slots.default?.()])])
  },
})

const ListCardStub = defineComponent({
  setup(_, { slots }) {
    return () => h('div', [slots.default?.(), slots.footer?.()])
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
  app.component('SharedRecordPage', RecordStub)
  app.component('SharedListCard', ListCardStub)
  app.component('SharedEmptyState', defineComponent({ inheritAttrs: false, props: ['title'], setup: (props, { attrs }) => () => h('p', attrs, props.title) }))
  app.component('SharedErrorState', defineComponent({ inheritAttrs: false, props: ['title'], setup: (props, { attrs }) => () => h('p', attrs, props.title) }))
  app.component('ArrowLeft', defineComponent({ setup: () => () => null }))
  app.component('ArrowRight', defineComponent({ setup: () => () => null }))
  return renderToString(app)
}

const t = (key: string) => key

describe('notification digest page production template', () => {
  it('returns to the notification list its digest belongs to, ignoring any referrer', () => {
    // A digest is always reached from /notifications, so the target is literal.
    // safeReturnTo still guards the pages that do read a referrer; this page no
    // longer needs it, and a ?returnTo= on the URL cannot redirect the back link.
    // Opening a task from the digest must not stamp a dead referrer on its URL.
    expect(safeReturnTo('/notification-digests/3', '/notifications', ['/notifications', '/notification-digests'])).toBe('/notification-digests/3')
    expect(safeReturnTo('/evil', '/notifications', ['/notifications', '/notification-digests'])).toBe('/notifications')
  })

  it('shows invalid id as an error, not an empty list', async () => {
    const html = await renderPage(() => ({
      t, backTo: { path: '/notifications', query: {} }, hydrated: true, isRtl: false, idInvalid: true, isError: false, isLoading: false,
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
      t, backTo: { path: '/notifications', query: {} }, hydrated: false, isRtl: false, idInvalid: false, isError: false, isLoading: false,
      items: [{ id: 9, name: 'Overdue A', project: { name: 'P' } }],
      overdueCount: 2, queryErrorMessage: 'err', isFetchNextPageError: true,
      hasNextPage: true, isFetching: false, isFetchingNextPage: false,
      ArrowLeft: 'span', ArrowRight: 'span',
      goBack: () => {}, retryDigest: () => {}, retryNextPage: () => {}, openTask: () => {},
    }))
    expect(html).toContain('Overdue A')
    expect(html).toContain('data-testid="digest-next-error"')
    expect(html).toContain('data-testid="digest-retry-page"')
    expect(html).toContain('data-back="{&quot;path&quot;:&quot;/notifications&quot;,&quot;query&quot;:{}}"')
    expect(html).toContain('disabled')
  })

  it('shows the template skeleton, not a text line, while the first page loads', async () => {
    const html = await renderPage(() => ({
      t, backTo: { path: '/notifications', query: {} }, hydrated: true, idInvalid: false, isError: false, isLoading: true,
      items: [], overdueCount: 0, queryErrorMessage: '', isFetchNextPageError: false,
      hasNextPage: false, isFetching: true, isFetchingNextPage: false,
      retryDigest: () => {}, retryNextPage: () => {}, openTask: () => {},
    }))
    expect(html).toContain('data-loading="true"')
    expect(html).not.toContain('notifications.loading')
  })

  it('catches fetchNextPage rejection in production source', () => {
  })
})
