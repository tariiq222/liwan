import type { Meta, StoryObj } from '@storybook/vue3-vite'
import CommunicationSendersCard from '../../app/components/settings/CommunicationSendersCard.vue'
import { storyContext } from '../support/context'
import { communicationHandlers } from './communicationHandlers'
import { archivedSenders, senders, twilio } from './integrationFixtures'

const meta = {
  title: 'Settings/CommunicationSendersCard', component: CommunicationSendersCard,
  parameters: { layout: 'padded', a11y: { test: 'error' }, ...storyContext('apps/web/app/pages/settings/integrations/communications.vue:28', 'بطاقة المرسلين: الأرقام وأسماء المرسل وخدمات الرسائل، مع حالات غياب الحساب وتوقفه وخطئه وغياب المرسل لقناة.') },
  args: { canManage: true },
  render: args => ({ components: { CommunicationSendersCard }, setup: () => ({ args }), template: '<div class="max-w-4xl"><CommunicationSendersCard v-bind="args" /></div>' }),
} satisfies Meta<typeof CommunicationSendersCard>
export default meta
type Story = StoryObj<typeof meta>

export const Senders: Story = { name: 'مرسلون', parameters: communicationHandlers() }
export const ReadOnly: Story = { name: 'عرض فقط', args: { canManage: false }, parameters: communicationHandlers() }
export const NoConnection: Story = { name: 'لا يوجد حساب', parameters: communicationHandlers({ connections: [], senders: [] }) }
export const DisabledConnection: Story = { name: 'الحساب متوقف', parameters: communicationHandlers({ connections: [{ ...twilio, state: 'disabled' }] }) }
export const ProviderRefused: Story = {
  name: 'رفض المزوّد الحساب',
  parameters: communicationHandlers({ connections: [{ ...twilio, state: 'error', status_message: 'رفضت Twilio رمز المصادقة.' }] }),
}
export const NoSenderForChannel: Story = { name: 'لا مرسل لقناة', parameters: communicationHandlers({ senders: [senders.items[2]!] }) }
export const NoSenderAtAll: Story = { name: 'لا مرسل', parameters: communicationHandlers({ senders: [] }) }
export const OnlyArchived: Story = { name: 'مرسل مؤرشف فقط', parameters: communicationHandlers({ senders: archivedSenders.items }) }
export const LoadFailed: Story = { name: 'تعذر التحميل', parameters: communicationHandlers({ sendersFailure: { status: 500, body: { code: 'server_error', message: 'تعذر التحميل' } } }) }
