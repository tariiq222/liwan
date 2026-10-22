import type { Meta, StoryObj } from '@storybook/vue3-vite'
import HomeAssistantSuggestions from '../../app/components/home/HomeAssistantSuggestions.vue'
import { assistantShellHandlers, declareStubAssistant } from '../shell/assistantSheetStub'
import { declareStoryAttention } from '../ai/aiSurfaceStub'
import { storyContext } from '../support/context'

const meta = {
  title: 'Home/AssistantSuggestions',
  component: HomeAssistantSuggestions,
  parameters: {
    layout: 'padded',
    a11y: { test: 'error' },
    msw: { handlers: { api: assistantShellHandlers } },
    ...storyContext('apps/web/app/pages/index.vue:33', 'مقترحات مبنية بقواعد من مهام المستخدم واجتماعاته، بلا نموذج. لا تظهر إلا لمن يملك المساعد وعند وجود اقتراح.'),
  },
  beforeEach: () => {
    const stopAssistant = declareStubAssistant()
    const stopAttention = declareStoryAttention()
    return () => { stopAttention(); stopAssistant() }
  },
  render: () => ({ components: { HomeAssistantSuggestions }, template: '<div class="mx-auto max-w-3xl"><HomeAssistantSuggestions /></div>' }),
} satisfies Meta<typeof HomeAssistantSuggestions>
export default meta
type Story = StoryObj<typeof meta>

export const Suggestions: Story = { name: 'اقتراحات اليوم' }
