import type { Meta, StoryObj } from '@storybook/vue3-vite'
import CommunicationTestCard from '../../app/components/settings/CommunicationTestCard.vue'
import { storyContext } from '../support/context'
import { communicationHandlers } from './communicationHandlers'

const meta = {
  title: 'Settings/CommunicationTestCard', component: CommunicationTestCard,
  parameters: { layout: 'padded', a11y: { test: 'error' }, ...storyContext('apps/web/app/pages/settings/integrations/communications.vue:25', 'بطاقة تجربة الإرسال: المرسل والمستلم ونص ثابت أو قالب، ثم حالة الرسالة المتابَعة.') },
  args: { canManage: true, canRetry: false },
  render: args => ({ components: { CommunicationTestCard }, setup: () => ({ args }), template: '<div class="max-w-2xl"><CommunicationTestCard v-bind="args" /></div>' }),
} satisfies Meta<typeof CommunicationTestCard>
export default meta
type Story = StoryObj<typeof meta>

export const Idle: Story = { name: 'جاهزة للإرسال', parameters: communicationHandlers() }
export const NoSender: Story = { name: 'لا مرسل للتجربة', parameters: communicationHandlers({ senders: [] }) }
export const SendLoadFailed: Story = { name: 'تعذر تحميل المرسلين', parameters: communicationHandlers({ sendersFailure: { status: 500, body: { code: 'server_error', message: 'تعذر التحميل' } } }) }
export const LimitReached: Story = {
  name: 'بلغ الحد اليومي',
  parameters: communicationHandlers({ testPost: { status: 429, body: { code: 'daily_limit_reached', message: 'بلغت الحد اليومي.' } } }),
}
