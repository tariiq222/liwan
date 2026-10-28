import type { Meta, StoryObj } from '@storybook/vue3-vite'
import CrmOpportunityCallForm from '../../../app/components/crm/opportunity/CrmOpportunityCallForm.vue'
import { storyContext } from '../../support/context'
import { lostReasons, outcomes, packages } from './crmOpportunityFixtures'

const meta = {
  title: 'CRM/CrmOpportunityCallForm',
  component: CrmOpportunityCallForm,
  parameters: storyContext('apps/web/app/pages/crm/opportunities/[id].vue:165', 'تسجيل اتصال: نتيجة البيع تفتح حقول البيع، ونتيجة خسارة بلا سبب تطلب السبب.'),
  args: { outcomes, packages, lostReasons },
} satisfies Meta<typeof CrmOpportunityCallForm>
export default meta
type Story = StoryObj<typeof meta>
export const Idle: Story = {}
export const Pending: Story = { args: { pending: true } }
export const Refused: Story = { args: { error: 'تغيّر هذا السجل أو أُغلق. حدّث الصفحة ثم أعد المحاولة.' } }
