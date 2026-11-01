import type { Meta, StoryObj } from '@storybook/vue3-vite'
import OwnInsuranceCard from '../../../app/components/hr/insurance/OwnInsuranceCard.vue'
import { storyContext } from '../../support/context'
import { ownEnrollmentFixture } from './fixtures'

// بطاقة تأمين الموظف نفسه في `/account/insurance`: الخطة والفترة ورقم العضوية والحصص، والتابعون حسب سياسة الشركة.
const meta = {
  title: 'HR/Insurance/OwnInsuranceCard',
  component: OwnInsuranceCard,
  parameters: storyContext('apps/web/app/pages/hr/self/insurance.vue:24', 'بطاقات تغطية الموظف نفسه للقراءة فقط، ولا تصله ملاحظات الموارد البشرية.'),
  args: { enrollment: ownEnrollmentFixture() },
} satisfies Meta<typeof OwnInsuranceCard>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { name: 'التسجيل والتابعون' }
export const EnrollmentOnly: Story = { name: 'التسجيل فقط', args: { enrollment: ownEnrollmentFixture({ dependents_visible: false, dependents: [] }) } }
export const Ended: Story = { name: 'تغطية منتهية', args: { enrollment: ownEnrollmentFixture({ state: 'ended', date_to: '2026-06-30', date_end: '2026-06-30' }) } }
