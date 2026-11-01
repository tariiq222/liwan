import type { Meta, StoryObj } from '@storybook/vue3-vite'
import OwnWarningCard from '../../../app/components/hr/warnings/OwnWarningCard.vue'
import { storyContext } from '../../support/context'
import { warningFixture } from './fixtures'

// بطاقة إنذار صادر بحق الموظف في `/account/warnings`: إقرار فوري أو اعتراض بملاحظة مطلوبة.
const meta = {
  title: 'HR/Warnings/OwnWarningCard',
  component: OwnWarningCard,
  parameters: storyContext('apps/web/app/pages/hr/self/warnings.vue:44', 'قائمة بطاقات إنذارات الموظف نفسه، والبطاقة التي تنتظر ردّه تأخذ تمييز الصفحة الوحيد.'),
  args: { warning: warningFixture(), pending: false },
} satisfies Meta<typeof OwnWarningCard>

export default meta
type Story = StoryObj<typeof meta>

export const PendingAnswer: Story = { name: 'ينتظر الرد' }
export const Optional: Story = { name: 'الرد اختياري', args: { warning: warningFixture({ acknowledgement: 'optional', ack_pending: false }) } }
export const ReadOnly: Story = { name: 'الرد معطّل', args: { warning: warningFixture({ acknowledgement: 'off', ack_pending: false }) } }
export const Contested: Story = {
  name: 'معترَض عليه',
  args: { warning: warningFixture({ state: 'contested', ack_pending: false, contest_note: 'لم أتلقَّ إشعارًا بتغيير ساعات الدوام.' }) },
}
export const Failed: Story = { name: 'تعذّر الرد', args: { error: 'تغيّر هذا الإنذار أثناء اطلاعك عليه.' } }
