import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import * as Vue from 'vue'
import { loadShared, renderShared } from '@webvue/ui/test/helpers/renderShared'
import { createHostNode, findNode, hostRenderer } from '@webvue/ui/test/helpers/hostRenderer'

const component = resolve(__dirname, '../AssistantButton.vue')
const state = (over: Partial<{ showButton: boolean; shown: boolean }> = {}) => ({
  surface: Vue.ref({ labelKey: 'ai.sheet.label' }),
  showButton: Vue.ref(over.showButton ?? true),
  shown: Vue.ref(over.shown ?? false),
  toggle: () => undefined,
})
const render = (over?: Parameters<typeof state>[0], hydrated = true) => renderShared(component, {}, {}, {
  hydrated, messages: { 'ai.sheet.label': 'المساعد' },
  modules: { '@/composables/useAssistantSheet': { ASSISTANT_SHEET_ID: 'assistant-sheet', useAssistantSheet: () => state(over) } },
})

describe('AssistantButton', () => {
  it('renders disabled before hydration and enables the same button to open its sheet when ready', async () => {
    expect(await render({}, false)).toMatch(/<button[^>]*disabled/)
    const hydrated = Vue.ref(false)
    const sheet = state()
    const toggle = vi.fn(() => { sheet.shown.value = true })
    const app = hostRenderer.createApp(loadShared(component, {
      messages: { 'ai.sheet.label': 'المساعد' },
      globals: { useHydrated: () => hydrated },
      modules: { '@/composables/useAssistantSheet': { ASSISTANT_SHEET_ID: 'assistant-sheet', useAssistantSheet: () => ({ ...sheet, toggle }) } },
    }))
    app.component('UIcon', Vue.defineComponent({ render: () => Vue.h('span') }))
    const host = createHostNode()
    app.mount(host)
    try {
      const button = findNode(host, node => node.props['data-testid'] === 'assistant-button')!
      expect(button.props.disabled).toBe(true)
      expect(toggle).not.toHaveBeenCalled()
      hydrated.value = true
      await Vue.nextTick()
      expect(button.props.disabled).toBe(false)
      ;(button.props.onClick as (event: { currentTarget: unknown }) => void)({ currentTarget: button })
      expect(toggle).toHaveBeenCalledExactlyOnceWith(button)
      await Vue.nextTick()
      expect(button.props['aria-expanded']).toBe(true)
    } finally {
      app.unmount()
    }
  })

  it('renders nothing when the sheet is not offered (no surface, no capability, or the full page)', async () => {
    expect(await render({ showButton: false })).not.toContain('<button')
  })

  it('is a real button labelled by the surface, pointing at the sheet', async () => {
    const html = await render()
    expect(html).toContain('<button')
    expect(html).toContain('type="button"')
    expect(html).toContain('aria-label="المساعد"')
    expect(html).toContain('aria-controls="assistant-sheet"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('webvue-assistant-button-label')
    expect(html).not.toContain('data-open')
  })

  it('shows the open state with aria-expanded and the ring marker', async () => {
    const html = await render({ shown: true })
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('data-open="true"')
  })
})
