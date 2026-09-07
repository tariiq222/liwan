import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileTemplate, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import ts from 'typescript'
import * as Vue from 'vue'
import { createSSRApp, defineComponent, h, type RenderFunction } from 'vue'
import { describe, expect, it } from 'vitest'

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../')
const notificationsSource = readFileSync(resolve(webRoot, 'app/pages/notifications.vue'), 'utf8')
const digestFilename = resolve(webRoot, 'app/pages/notification-digests/[id].vue')
const digestSource = readFileSync(digestFilename, 'utf8')

const Passthrough = defineComponent({
  inheritAttrs: false,
  setup(_, { slots, attrs }) {
    return () => h('div', attrs, [slots.back?.(), slots.actions?.(), slots.default?.()])
  },
})

function loadDigestPage(setup: () => Record<string, unknown>) {
  const parsed = parse(digestSource, { filename: digestFilename })
  if (!parsed.descriptor.template) throw new Error('no template')
  const compiled = compileTemplate({
    source: parsed.descriptor.template.content,
    filename: digestFilename,
    id: 'digest-page-design',
    compilerOptions: { mode: 'function', expressionPlugins: ['typescript'] },
  })
  const runnableCode = ts.transpileModule(compiled.code, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  }).outputText
  const render = new Function('Vue', runnableCode)(Vue) as RenderFunction
  return defineComponent({ setup, render })
}

describe('notification pages shared header contract', () => {
  it('keeps the notification feed on form width with history back, not list chrome', () => {
    expect(notificationsSource).toContain('SharedPageContainer')
    expect(notificationsSource).toContain('SharedPageHeader')
    expect(notificationsSource).toContain('width="form"')
    expect(notificationsSource).not.toContain('width="list"')
    expect(notificationsSource).toContain('router.back()')
    expect(notificationsSource).toContain('nasq-panel')
    expect(notificationsSource).not.toContain('SharedPageState')
    expect(notificationsSource).not.toMatch(/<h1[^>]*text-2xl/)
  })

  it('registers digest title through SharedPageHeader and keeps safeReturnTo back', () => {
    expect(digestSource).toContain('SharedPageContainer')
    expect(digestSource).toContain('SharedPageHeader')
    expect(digestSource).toContain(":title=\"t('tasks.digest.title')\"")
    expect(digestSource).toContain('width="form"')
    expect(digestSource).not.toContain('width="list"')
    expect(digestSource).toContain('safeReturnTo')
    expect(digestSource).toContain('goBack')
    expect(digestSource).toContain('<template #back>')
    expect(digestSource).toContain('<template #actions>')
    expect(digestSource).toContain('data-testid="digest-back"')
    expect(digestSource).not.toContain('router.back()')
    expect(digestSource).not.toMatch(/<h1[\s\S]*text-2xl/)
    expect(digestSource).not.toContain('SharedPageState')
    expect(digestSource).toContain('nasq-panel')
    expect(digestSource).toContain('data-testid="digest-load-more"')
  })

  it('still renders digest back, invalid id, and next-page retry through shared chrome', async () => {
    const t = (key: string) => key
    const app = createSSRApp({
      render: () => h(loadDigestPage(() => ({
        t,
        hydrated: false,
        isRtl: false,
        idInvalid: false,
        isError: false,
        isLoading: false,
        items: [{ id: 9, name: 'Overdue A', project: { name: 'P' } }],
        overdueCount: 2,
        queryErrorMessage: 'err',
        isFetchNextPageError: true,
        hasNextPage: true,
        isFetching: false,
        isFetchingNextPage: false,
        ArrowLeft: 'span',
        ArrowRight: 'span',
        goBack: () => {},
        retryDigest: () => {},
        retryNextPage: () => {},
        openTask: () => {},
      }))),
    })
    app.component('Button', Passthrough)
    app.component('SharedPageContainer', Passthrough)
    app.component('SharedPageHeader', Passthrough)
    const html = await renderToString(app)
    expect(html).toContain('data-testid="digest-back"')
    expect(html).toContain('Overdue A')
    expect(html).toContain('data-testid="digest-next-error"')
    expect(html).toContain('data-testid="digest-retry-page"')
    expect(html).not.toContain('text-2xl')
  })
})
