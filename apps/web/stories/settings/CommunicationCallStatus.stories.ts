import type { Meta, StoryObj } from '@storybook/vue3-vite'
import CommunicationCallStatus from '../../app/components/settings/CommunicationCallStatus.vue'
import { storyContext } from '../support/context'
import { callBusy, callCanceled, callCompleted, callFailed, callInProgress, callInitiated, callNoAnswer, callRinging, callUnconfirmed } from './integrationFixtures'

const meta = {
  title: 'Settings/CommunicationCallStatus', component: CommunicationCallStatus,
  parameters: { layout: 'padded', a11y: { test: 'error' }, ...storyContext('apps/web/app/components/settings/CommunicationVoiceTestCard.vue:128', 'حالة مكالمة واحدة: الشارة وسطر يشرح معناها وخطأ المزوّد إن وُجد، وتحذير «لا تُعِد المكالمة» للحالة غير المؤكدة لأن المكالمة لا تُعاد تلقائيًا.') },
  args: { call: callInitiated },
  render: args => ({ components: { CommunicationCallStatus }, setup: () => ({ args }), template: '<div class="max-w-xl"><CommunicationCallStatus v-bind="args" /></div>' }),
} satisfies Meta<typeof CommunicationCallStatus>
export default meta
type Story = StoryObj<typeof meta>

export const Initiated: Story = { name: 'أُجريت', args: { call: callInitiated } }
export const Ringing: Story = { name: 'تُرنّ', args: { call: callRinging } }
export const InProgress: Story = { name: 'جارية', args: { call: callInProgress } }
export const Completed: Story = { name: 'اكتملت', args: { call: callCompleted } }
export const Busy: Story = { name: 'الخط مشغول', args: { call: callBusy } }
export const NoAnswer: Story = { name: 'لم يُجب أحد', args: { call: callNoAnswer } }
export const Failed: Story = { name: 'فشلت', args: { call: callFailed } }
export const Canceled: Story = { name: 'أُلغيت', args: { call: callCanceled } }
export const Unconfirmed: Story = { name: 'غير مؤكدة مع تحذير عدم الإعادة', args: { call: callUnconfirmed } }
