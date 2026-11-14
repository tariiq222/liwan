import { resolve } from 'node:path'
import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { SETUP_STEP_KEYS, SetupProgressSchema } from '@liwan/contracts'
import { DEFAULT_STUBS, renderShared } from '@liwan/ui/test/helpers/renderShared'

const file = resolve(import.meta.dirname, '../SetupHomeCard.vue')
const UButton = Vue.defineComponent({ inheritAttrs: false, props: { to: { type: String, default: '' }, label: { type: String, default: '' } }, setup: (props, { attrs }) => () => Vue.h('a', { ...attrs, href: props.to }, props.label) })
const SharedProgress = Vue.defineComponent({ props: { value: { type: Number, default: 0 } }, setup: props => () => Vue.h('i', { 'data-value': props.value }) })
const messages = { 'setup.home.title': 'أكمل إعداد شركتك', 'setup.home.description': 'وصف', 'setup.home.open': 'تابع الإعداد', 'setup.progress': '{done} من {total}', 'setup.progressLabel': 'تقدّم' }
const progress = (done: number, closed_at: string | null = null) => SetupProgressSchema.parse({
  steps: SETUP_STEP_KEYS.map((key, index) => ({ key, outcome: index < done ? 'done' : null, recorded_by: null, recorded_at: null })),
  closed_at, complete: false,
})

async function render({ allowed = true, data = progress(2) as ReturnType<typeof progress> | null } = {}) {
  const useSetupProgress = vi.fn((_enabled: () => boolean) => ({ data: Vue.ref(data ?? undefined) }))
  const html = await renderShared(file, {}, {}, {
    messages, stubs: { ...DEFAULT_STUBS, UButton, SharedProgress },
    globals: { useMe: () => ({ me: Vue.ref({ capabilities: [] }) }) },
    modules: {
      '@/composables/setup/useSetupProgress': { useSetupProgress },
      '@/composables/setup/setupSteps': { ...(await import('../../../composables/setup/setupSteps')), canUseSetup: () => allowed },
    },
  })
  return { html, useSetupProgress }
}

describe('SetupHomeCard', () => {
  it('shows "n of 5" and a link to /setup while the wizard is open', async () => {
    const { html } = await render()
    expect(html).toContain('2 من 5')
    expect(html).toMatch(/href="\/setup"/)
    expect(html).toContain('data-value="40"')
  })

  it('asks for the progress only when the route admits the user', async () => {
    const denied = await render({ allowed: false, data: null })
    expect(denied.useSetupProgress.mock.calls[0]![0]()).toBe(false)
    expect(denied.html).not.toContain('setup-home-card')
    const allowed = await render()
    expect(allowed.useSetupProgress.mock.calls[0]![0]()).toBe(true)
  })

  it('shows nothing once the wizard is closed or when the progress could not be read', async () => {
    expect((await render({ data: progress(5, '2026-11-13T10:00:00') })).html).not.toContain('setup-home-card')
    expect((await render({ data: null })).html).not.toContain('setup-home-card')
  })
})
