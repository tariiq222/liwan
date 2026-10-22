import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as Vue from 'vue'
import { renderShared } from '@webvue/ui/test/helpers/renderShared'

const component = resolve(__dirname, '../AssistantSheet.vue')
const Body = Vue.defineComponent({ render: () => Vue.h('div', { 'data-testid': 'stub-body' }, 'body') })
const surface = { capability: 'ai.use', labelKey: 'ai.sheet.label', to: '/ai', load: async () => ({ default: Body }) }

interface Options { shown?: boolean; mode?: 'push' | 'overlay' | 'full'; module?: string | null }
async function render({ shown = false, mode = 'push', module = 'finance' }: Options = {}) {
  const sheet = {
    shown: Vue.ref(shown), onSurfacePage: Vue.ref(false), bodyLoaded: Vue.ref(false),
    close: () => undefined, restoreSession: () => undefined, takeFocusRequest: () => false,
    fullPageTo: (id: string | null) => ({ path: '/ai', query: id ? { context: id } : {} }),
  }
  const NuxtLink = Vue.defineComponent({
    inheritAttrs: false,
    props: { to: { type: Object, default: null } },
    setup(props, { attrs, slots }) { return () => Vue.h('a', { ...attrs, href: `${props.to?.path}?context=${props.to?.query?.context ?? ''}` }, slots.default?.()) },
  })
  return renderShared(component, { surface }, {}, {
    messages: {
      'ai.sheet.label': 'المساعد', 'nav.finance': 'المالية',
      'nav.assistantSheet.region': 'لوحة المساعد', 'nav.assistantSheet.close': 'إغلاق المساعد', 'nav.assistantSheet.openFullPage': 'فتح بملء الصفحة',
    },
    stubs: { NuxtLink },
    modules: {
      '@vueuse/core': { useEventListener: () => undefined, useMediaQuery: () => Vue.ref(true) },
      '@/composables/useAssistantSheet': {
        ASSISTANT_SHEET_ID: 'assistant-sheet',
        assistantBodyView: () => Body,
        assistantEscapeCloses: () => false,
        assistantSheetMode: () => mode,
        holdPageBehind: () => () => undefined,
        useAssistantSheet: () => sheet,
      },
      '@/composables/useShellModel': {
        useShellModel: () => ({ activeModule: Vue.ref(module), rail: Vue.ref({ all: [{ id: 'finance', labelKey: 'nav.finance', icon: 'i-lucide-landmark', to: '/finance' }] }) }),
      },
      '@webvue/ui/app/composables/useEscapeBack': { overlayOwnsEscape: () => false },
    },
  })
}

describe('AssistantSheet', () => {
  it('is a labelled complementary region with the sheet id, hidden while closed and without a body yet', async () => {
    const html = await render()
    expect(html).toContain('<aside')
    expect(html).toContain('id="assistant-sheet"')
    expect(html).toContain('aria-label="لوحة المساعد"')
    expect(html).toContain('display:none')
    expect(html).not.toContain('role=')
    expect(html).not.toContain('stub-body')
  })

  it('shows the title, the current module, the full-page link with its context, and a real close button', async () => {
    const html = await render({ shown: true })
    expect(html).not.toContain('display:none')
    expect(html).toContain('>المساعد</h2>')
    expect(html).toContain('data-testid="assistant-sheet-module">المالية<')
    expect(html).toContain('href="/ai?context=finance"')
    expect(html).toContain('aria-label="فتح بملء الصفحة"')
    expect(html).toMatch(/<button[^>]*type="button"[^>]*aria-label="إغلاق المساعد"|<button[^>]*aria-label="إغلاق المساعد"[^>]*type="button"/)
  })

  it('mounts the body only once the sheet has been open', async () => {
    expect(await render({ shown: true })).toContain('stub-body')
  })

  it('leaves out the module pill on a page no application owns', async () => {
    expect(await render({ shown: true, module: null })).not.toContain('assistant-sheet-module')
  })

  it('draws a scrim only in the overlay layout, and a modal dialog only in full screen', async () => {
    expect(await render({ shown: true, mode: 'overlay' })).toContain('webvue-assistant-scrim')
    expect(await render({ shown: true, mode: 'push' })).not.toContain('webvue-assistant-scrim')
    expect(await render({ shown: false, mode: 'overlay' })).not.toContain('webvue-assistant-scrim')
    const full = await render({ shown: true, mode: 'full' })
    expect(full).not.toContain('webvue-assistant-scrim')
    expect(full).toContain('role="dialog"')
    expect(full).toContain('aria-modal="true"')
  })
})
