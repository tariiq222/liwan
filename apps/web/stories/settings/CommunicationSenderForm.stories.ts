import type { Meta, StoryObj } from '@storybook/vue3-vite'
import CommunicationSenderForm from '../../app/components/settings/CommunicationSenderForm.vue'
import { storyContext } from '../support/context'
import { communicationHandlers } from './communicationHandlers'

const meta = {
  title: 'Settings/CommunicationSenderForm', component: CommunicationSenderForm,
  parameters: { layout: 'padded', a11y: { test: 'error' }, ...storyContext('apps/web/app/pages/settings/integrations/communications/senders/new.vue:15', 'نموذج لوحة إضافة مرسل: الحساب والقناة والنوع والقيمة، ورقم الرسائل النصية يُختار من أرقام الحساب.') },
  args: { backTo: '/settings/integrations/communications' },
  render: args => ({ components: { CommunicationSenderForm }, setup: () => ({ args }), template: '<div class="max-w-xl"><CommunicationSenderForm v-bind="args" /></div>' }),
} satisfies Meta<typeof CommunicationSenderForm>
export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = { name: 'فارغ', parameters: communicationHandlers() }
export const ProviderError: Story = {
  name: 'تعذر جلب أرقام الحساب',
  parameters: communicationHandlers({ available: { status: 502, body: { code: 'provider_error', message: 'تعذر الاتصال بـ Twilio.' } } }),
}
export const NoNumbers: Story = { name: 'لا أرقام تدعم الرسائل', parameters: communicationHandlers({ available: { status: 200, body: { items: [], total: 0 } } }) }
export const Refused: Story = {
  name: 'رفض الخادم القيمة',
  parameters: communicationHandlers({ senderPost: { status: 422, body: { code: 'invalid', message: 'هذا المرسل مضاف بالفعل لهذه القناة.', field: 'value' } } }),
}
