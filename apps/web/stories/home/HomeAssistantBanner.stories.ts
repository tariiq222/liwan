import type { Meta, StoryObj } from '@storybook/vue3-vite'
import HomeAssistantBanner from '../../app/components/home/HomeAssistantBanner.vue'
import { assistantShellHandlers, declareStubAssistant } from '../shell/assistantSheetStub'
import { declareStoryAttention } from '../ai/aiSurfaceStub'
import { storyContext } from '../support/context'

const meta = {
  title: 'Home/AssistantBanner',
  component: HomeAssistantBanner,
  parameters: {
    layout: 'padded',
    a11y: { test: 'error' },
    msw: { handlers: { api: assistantShellHandlers } },
    ...storyContext('apps/web/app/pages/index.vue:22', 'لافتة ليوان AI: حتى ثلاثة أشياء من مهام المستخدم واجتماعاته بقواعد بلا نموذج، وزر إلى المساعد. لا تظهر إلا لمن يملك المساعد.'),
  },
  beforeEach: () => {
    const stopAssistant = declareStubAssistant()
    const stopAttention = declareStoryAttention()
    return () => { stopAttention(); stopAssistant() }
  },
  render: () => ({ components: { HomeAssistantBanner }, template: '<div class="mx-auto max-w-5xl"><HomeAssistantBanner /></div>' }),
} satisfies Meta<typeof HomeAssistantBanner>
export default meta
type Story = StoryObj<typeof meta>

export const Suggestions: Story = { name: 'اقتراحات اليوم' }
