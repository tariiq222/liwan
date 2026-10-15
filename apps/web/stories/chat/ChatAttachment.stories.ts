import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { ChatAttachmentSchema } from '@nasq/contracts'
import ChatAttachment from '../../app/components/chat/ChatAttachment.vue'
import FormSection from '../../app/components/shared/layout/FormSection.vue'
import { storyContext } from '../support/context'

const attachments = ChatAttachmentSchema.array().parse([
  { id: 31, name: 'محضر-الاجتماع.pdf', mimetype: 'application/pdf', url: '/web/content/31' },
  { id: 32, name: 'خطة-المشروع-النهائية-بعد-المراجعة.xlsx', mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', url: '/web/content/32' },
])

const meta = {
  title: 'Chat/ChatAttachment',
  component: ChatAttachment,
  args: { attachment: attachments[0]! },
} satisfies Meta<typeof ChatAttachment>
export default meta
type Story = StoryObj<typeof meta>

export const InMessage: Story = {
  name: 'داخل رسالة',
  parameters: storyContext('apps/web/app/components/chat/MessageHistory.vue:306'),
  render: () => ({
    components: { ChatAttachment },
    setup: () => ({ attachments }),
    template: '<div class="mt-2 flex flex-col gap-1"><ChatAttachment v-for="attachment in attachments" :key="attachment.id" :attachment="attachment" /></div>',
  }),
}

export const InConversationInfo: Story = {
  name: 'في معلومات المحادثة',
  parameters: storyContext('apps/web/app/components/chat/ChatInfoPanel.vue:123'),
  render: () => ({
    components: { ChatAttachment, FormSection },
    setup: () => ({ attachments }),
    template: `<FormSection :title="$t('chat.attachments')"><div class="flex flex-col gap-2"><ChatAttachment v-for="attachment in attachments" :key="attachment.id" :attachment="attachment" /></div></FormSection>`,
  }),
}
