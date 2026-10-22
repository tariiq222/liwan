import type { Meta, StoryObj } from '@storybook/vue3-vite'
import AiSheet from '../../app/components/ai/AiSheet.vue'
import { __getRouter } from '../../.storybook/nuxt-shims'
import { assistantShellHandlers } from '../shell/assistantSheetStub'
import { declareStoryAttention } from './aiSurfaceStub'
import { storyContext } from '../support/context'

// The sheet's body at its real width, under the shell's own header row. The page the user is on picks "in this page now".
const meta = {
  title: 'Ai/Sheet',
  component: AiSheet,
  parameters: {
    layout: 'centered',
    a11y: { test: 'error' },
    msw: { handlers: { api: assistantShellHandlers } },
    ...storyContext('apps/web/app/modules/ai/manifest.ts:14', 'محتوى الشيت: قسم «في هذه الصفحة الآن» ثم المحادثة نفسها المضغوطة. الشيت يحتاج `aiEnabled` في إعدادات التشغيل.'),
  },
  beforeEach: declareStoryAttention,
  loaders: [async () => { await __getRouter()!.replace('/tasks'); return {} }],
  render: () => ({
    components: { AiSheet },
    template: '<div class="flex h-[40rem] w-[380px] flex-col overflow-hidden rounded-card border border-default bg-default"><AiSheet /></div>',
  }),
} satisfies Meta<typeof AiSheet>
export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = { name: 'محادثة جديدة' }
