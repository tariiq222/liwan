import type { Meta, StoryObj } from '@storybook/vue3-vite'
import AppSidebar from '../../app/components/shell/AppSidebar.vue'
import AssistantSheet from '../../app/components/shell/AssistantSheet.vue'
import ShellFrame from '@webvue/ui/app/components/shell/ShellFrame.vue'
import ShellHeader from '../../app/components/shell/ShellHeader.vue'
import { useAssistantSheet } from '../../app/composables/useAssistantSheet'
import { __getRouter, useState } from '../../.storybook/nuxt-shims'
import { assistantShellHandlers, declareStubAssistant, stubSurface } from './assistantSheetStub'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shell/AssistantSheet',
  component: AssistantSheet,
  args: { surface: stubSurface },
  parameters: { layout: 'fullscreen', msw: { handlers: { api: assistantShellHandlers } } },
  beforeEach: declareStubAssistant,
} satisfies Meta<typeof AssistantSheet>
export default meta
type Story = StoryObj<typeof meta>

const at = (path: string) => async () => { await __getRouter()!.replace(path); return {} }
// The open state is set in setup: the global loader resets the shim state concurrently with story loaders.
const frame = (open: boolean) => () => ({
  components: { AppSidebar, AssistantSheet, ShellFrame, ShellHeader },
  setup: () => {
    useState<boolean>('assistant-sheet-open').value = open
    return { assistant: useAssistantSheet() }
  },
  template: `<ShellFrame :sheet-open="assistant.shown.value">
    <template #header><ShellHeader /></template>
    <template #sidebar><AppSidebar /></template>
    <template #sheet><AssistantSheet v-if="assistant.surface.value" :surface="assistant.surface.value" /></template>
    <main class="webvue-shell-main" data-testid="shell-main"><div class="webvue-page-stack webvue-page-width-list"><h1 class="text-xl font-semibold">المهام</h1></div></main>
  </ShellFrame>`,
})

export const Open: Story = {
  name: 'مفتوح بجانب الصفحة',
  parameters: storyContext('apps/web/app/layouts/default.vue:75', 'من 1100px تحجز الصفحة مكان اللوحة، وتنطوي القائمة السياقية إلى شريط 64px. أقل من ذلك تطفو اللوحة فوق الصفحة، وتحت 768px تملأ الشاشة.'),
  loaders: [at('/tasks')],
  render: frame(true),
}

export const Closed: Story = {
  name: 'مغلق',
  parameters: storyContext('apps/web/app/layouts/default.vue:75'),
  loaders: [at('/tasks')],
  render: frame(false),
}
