import type { Meta, StoryObj } from '@storybook/vue3-vite'
import CommunicationLookupCard from '../../app/components/settings/CommunicationLookupCard.vue'
import { storyContext } from '../support/context'
import { communicationHandlers } from './communicationHandlers'

const meta = {
  title: 'Settings/CommunicationLookupCard', component: CommunicationLookupCard,
  parameters: { layout: 'padded', a11y: { test: 'error' }, ...storyContext('apps/web/app/pages/settings/integrations/communications.vue:32', 'بطاقة التحقق من رقم: الرقم وخيار نوع الخط المدفوع، ثم الإجابة: الصحة وصيغة E.164 والدولة ونوع الخط.') },
  args: { canManage: true },
  render: args => ({ components: { CommunicationLookupCard }, setup: () => ({ args }), template: '<div class="max-w-2xl"><CommunicationLookupCard v-bind="args" /></div>' }),
} satisfies Meta<typeof CommunicationLookupCard>
export default meta
type Story = StoryObj<typeof meta>

export const Idle: Story = { name: 'جاهزة للتحقق', parameters: communicationHandlers() }
export const ReadOnly: Story = { name: 'عرض فقط', args: { canManage: false }, parameters: communicationHandlers() }
export const InvalidNumber: Story = {
  name: 'رقم غير صحيح',
  parameters: communicationHandlers({ lookupPost: { status: 200, body: { valid: false, e164: null, country: null, line_type: null } } }),
}
export const WithLineType: Story = {
  name: 'باستعلام نوع الخط',
  parameters: communicationHandlers({ lookupPost: { status: 200, body: { valid: true, e164: '+966555000014', country: 'SA', line_type: 'mobile' } } }),
}
export const NoConnection: Story = {
  name: 'لا حساب متصل',
  parameters: communicationHandlers({ lookupPost: { status: 422, body: { code: 'no_connection', message: 'لا يوجد حساب متصل يستطيع التحقق من الأرقام.' } } }),
}
export const LookupFailed: Story = {
  name: 'تعذّر التحقق',
  parameters: communicationHandlers({ lookupPost: { status: 502, body: { code: 'lookup_failed', message: 'تعذّر الاتصال بـ Twilio.' } } }),
}
