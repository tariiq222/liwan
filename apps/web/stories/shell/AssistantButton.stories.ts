import type { Meta, StoryObj } from '@storybook/vue3-vite'
import AssistantButton from '../../app/components/shell/AssistantButton.vue'
import { __getRouter, useState } from '../../.storybook/nuxt-shims'
import { assistantShellHandlers, declareStubAssistant } from './assistantSheetStub'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shell/AssistantButton',
  component: AssistantButton,
  parameters: { layout: 'centered', msw: { handlers: { api: assistantShellHandlers } } },
  beforeEach: declareStubAssistant,
} satisfies Meta<typeof AssistantButton>
export default meta
type Story = StoryObj<typeof meta>

const at = (path: string) => async () => { await __getRouter()!.replace(path); return {} }
// The open state is set in setup: the global loader resets the shim state concurrently with story loaders.
const render = (open: boolean) => () => ({
  components: { AssistantButton },
  setup: () => { useState<boolean>('assistant-sheet-open').value = open },
  template: '<div class="webvue-shell" style="padding: 24px"><AssistantButton /></div>',
})

export const Closed: Story = { name: 'مغلق', parameters: storyContext('apps/web/app/components/shell/ShellHeader.vue:86'), loaders: [at('/tasks')], render: render(false) }
export const Open: Story = { name: 'مفتوح', parameters: storyContext('apps/web/app/components/shell/ShellHeader.vue:86', 'حلقة أولية بسماكة 2px وaria-expanded.'), loaders: [at('/tasks')], render: render(true) }
