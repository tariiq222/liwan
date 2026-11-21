import type { Meta, StoryObj } from '@storybook/vue3-vite'
import CommunicationVoiceTestCard from '../../app/components/settings/CommunicationVoiceTestCard.vue'
import { storyContext } from '../support/context'
import { communicationHandlers } from './communicationHandlers'

const meta = {
  title: 'Settings/CommunicationVoiceTestCard', component: CommunicationVoiceTestCard,
  parameters: { layout: 'padded', a11y: { test: 'error' }, ...storyContext('apps/web/app/pages/settings/integrations/communications.vue:31', 'بطاقة تجربة المكالمة: نص منطوق أو توصيل رقمين، والنتيجة تُستطلع حتى حالة نهائية، والحالة غير المؤكدة تحذّر من إعادة المكالمة.') },
  args: { canManage: true },
  render: args => ({ components: { CommunicationVoiceTestCard }, setup: () => ({ args }), template: '<div class="max-w-2xl"><CommunicationVoiceTestCard v-bind="args" /></div>' }),
} satisfies Meta<typeof CommunicationVoiceTestCard>
export default meta
type Story = StoryObj<typeof meta>

export const Idle: Story = { name: 'جاهزة لإجراء المكالمة', parameters: communicationHandlers() }
export const NoVoiceSender: Story = { name: 'لا رقم صوت للتجربة', parameters: communicationHandlers({ senders: [] }) }
export const SendersLoadFailed: Story = { name: 'تعذر تحميل أرقام الصوت', parameters: communicationHandlers({ sendersFailure: { status: 500, body: { code: 'server_error', message: 'تعذر التحميل' } } }) }
export const DailyLimitReached: Story = {
  name: 'بلغ حد المكالمات اليومي',
  parameters: communicationHandlers({ voicePost: { status: 429, body: { code: 'daily_limit_reached', message: 'بلغت حد المكالمات اليومي.' } } }),
}
export const CallUnconfirmed: Story = {
  name: 'مكالمة غير مؤكدة',
  parameters: communicationHandlers({ voiceGet: { status: 200, body: { id: 109, mode: 'speak', origin: 'test', state: 'unconfirmed', to: '+966555000019', from_value: '+966500000003', duration_seconds: null, recorded: false, error_code: null, error_message: null, created_at: '2030-01-15T11:00:00Z', started_at: null, ended_at: null } } }),
}
