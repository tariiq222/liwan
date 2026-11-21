import type { Meta, StoryObj } from '@storybook/vue3-vite'
import CommunicationMessageStatus from '../../app/components/settings/CommunicationMessageStatus.vue'
import { storyContext } from '../support/context'
import { messageDelivered, messageFailed, messageQueued, messageSent, messageSentNoReceipt, messageUndelivered, messageUnconfirmed } from './integrationFixtures'

const meta = {
  title: 'Settings/CommunicationMessageStatus', component: CommunicationMessageStatus,
  parameters: { layout: 'padded', a11y: { test: 'error' }, ...storyContext('apps/web/app/components/settings/CommunicationTestCard.vue:127', 'حالة رسالة واحدة: الشارة وسطر يشرح معناها وخطأ المزوّد إن وُجد، وزر إعادة الإرسال الذي يحذّر من الإرسال المزدوج للرسالة غير المؤكدة.') },
  args: { message: messageQueued, canRetry: true, retrying: false },
  render: args => ({ components: { CommunicationMessageStatus }, setup: () => ({ args }), template: '<div class="max-w-xl"><CommunicationMessageStatus v-bind="args" /></div>' }),
} satisfies Meta<typeof CommunicationMessageStatus>
export default meta
type Story = StoryObj<typeof meta>

export const Queued: Story = { name: 'في الانتظار', args: { message: messageQueued } }
export const Sent: Story = { name: 'أُرسلت', args: { message: messageSent } }
export const SentWithoutReceipt: Story = { name: 'أُرسلت بلا إيصال تسليم', args: { message: messageSentNoReceipt } }
export const Delivered: Story = { name: 'وصلت', args: { message: messageDelivered } }
export const Undelivered: Story = { name: 'لم تصل', args: { message: messageUndelivered } }
export const Failed: Story = { name: 'فشلت مع إعادة الإرسال', args: { message: messageFailed } }
export const Unconfirmed: Story = { name: 'غير مؤكدة مع إعادة الإرسال', args: { message: messageUnconfirmed } }
export const UnconfirmedWithoutLogRight: Story = { name: 'غير مؤكدة بلا صلاحية السجل', args: { message: messageUnconfirmed, canRetry: false } }
