import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as Vue from 'vue'
import { renderShared } from '@webvue/ui/test/helpers/renderShared'

const component = resolve(__dirname, '../AssistantButton.vue')
const state = (over: Partial<{ showButton: boolean; shown: boolean }> = {}) => ({
  surface: Vue.ref({ labelKey: 'ai.sheet.label' }),
  showButton: Vue.ref(over.showButton ?? true),
  shown: Vue.ref(over.shown ?? false),
  toggle: () => undefined,
})
const render = (over?: Parameters<typeof state>[0]) => renderShared(component, {}, {}, {
  messages: { 'ai.sheet.label': 'المساعد' },
  modules: { '@/composables/useAssistantSheet': { ASSISTANT_SHEET_ID: 'assistant-sheet', useAssistantSheet: () => state(over) } },
})

describe('AssistantButton', () => {
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
