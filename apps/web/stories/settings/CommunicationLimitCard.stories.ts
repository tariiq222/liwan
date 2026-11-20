import type { Meta, StoryObj } from '@storybook/vue3-vite'
import CommunicationLimitCard from '../../app/components/settings/CommunicationLimitCard.vue'
import { storyContext } from '../support/context'
import { communicationHandlers } from './communicationHandlers'

const meta = {
  title: 'Settings/CommunicationLimitCard', component: CommunicationLimitCard,
  parameters: { layout: 'padded', a11y: { test: 'error' }, ...storyContext('apps/web/app/pages/settings/integrations/communications.vue:24', 'بطاقة الحد اليومي للرسائل: القيمة المحفوظة وتعديلها مع التحقق وحالة الحفظ.') },
  args: { canManage: true },
  render: args => ({ components: { CommunicationLimitCard }, setup: () => ({ args }), template: '<div class="max-w-2xl"><CommunicationLimitCard v-bind="args" /></div>' }),
} satisfies Meta<typeof CommunicationLimitCard>
export default meta
type Story = StoryObj<typeof meta>

export const Limit: Story = { name: 'الحد اليومي', parameters: communicationHandlers() }
export const ReadOnly: Story = { name: 'عرض فقط', args: { canManage: false }, parameters: communicationHandlers() }
export const Rejected: Story = {
  name: 'رفض الخادم القيمة',
  parameters: communicationHandlers({ settingsPatch: { status: 422, body: { code: 'invalid', message: 'الحد اليومي يجب أن يكون بين 1 و100000.', field: 'daily_message_limit' } } }),
}
export const LoadFailed: Story = { name: 'تعذر التحميل', parameters: communicationHandlers({ settings: { status: 500, body: { code: 'server_error', message: 'تعذر التحميل' } } }) }
