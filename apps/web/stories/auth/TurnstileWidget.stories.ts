import type { Meta, StoryObj } from '@storybook/vue3-vite'
import TurnstileWidget from '../../app/components/auth/TurnstileWidget.vue'
import { storyContext } from '../support/context'

// The stories never load Cloudflare's script: `window.turnstile` is a stub that draws a placeholder box, so the
// component takes its "script already loaded" path and no network request is made.
type Stub = { render: (container: HTMLElement, options: Record<string, (...args: unknown[]) => void>) => string; reset: () => void; remove: () => void }
const install = (render: Stub['render']) => {
  (globalThis as { turnstile?: Stub }).turnstile = { render, reset: () => {}, remove: () => {} }
}
const placeholder = (container: HTMLElement, text: string) => {
  container.innerHTML = `<div style="width:300px;height:65px;display:flex;align-items:center;justify-content:center;border:1px solid currentColor;border-radius:8px;font-size:14px">${text}</div>`
}

const meta = {
  title: 'Auth/TurnstileWidget',
  component: TurnstileWidget,
  parameters: { layout: 'centered', a11y: { test: 'error' }, ...storyContext('apps/web/app/pages/register.vue:237') },
  args: { siteKey: 'site-key-fixture', scriptUrl: 'https://widget.example.test/api.js', language: 'ar', label: 'التحقق الأمني' },
} satisfies Meta<typeof TurnstileWidget>
export default meta
type Story = StoryObj<typeof meta>

export const Ready: Story = {
  name: 'جاهز',
  render: args => ({
    components: { TurnstileWidget },
    setup: () => {
      install((container, options) => { placeholder(container, 'Turnstile'); options.callback?.('story-token'); return 'story-widget' })
      return { args }
    },
    template: '<TurnstileWidget v-bind="args" />',
  }),
}

export const English: Story = { ...Ready, name: 'الإنجليزية', args: { language: 'en', label: 'Security check' } }

export const Failed: Story = {
  name: 'تعذر التحميل',
  render: args => ({
    components: { TurnstileWidget },
    setup: () => {
      install(container => { placeholder(container, '—'); throw new Error('turnstile_blocked') })
      return { args }
    },
    template: '<TurnstileWidget v-bind="args" />',
  }),
}
