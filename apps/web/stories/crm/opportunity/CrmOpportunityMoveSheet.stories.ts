import type { Meta, StoryObj } from '@storybook/vue3-vite'
import CrmOpportunityMoveSheet from '../../../app/components/crm/opportunity/CrmOpportunityMoveSheet.vue'
import { storyContext } from '../../support/context'
import { lostReasons, opportunities, packages, stages } from './crmOpportunityFixtures'

const item = opportunities[0]!
const meta = {
  title: 'CRM/CrmOpportunityMoveSheet',
  component: CrmOpportunityMoveSheet,
  parameters: storyContext('apps/web/app/components/crm/opportunity/CrmOpportunityList.vue:109', 'شيت نقل بطاقة في لوحة المراحل: يسأل الحقول المطلوبة فقط ثم يؤكد النقل.'),
  args: { stages, packages, lostReasons, move: { item, to: stages[3]!, revert: () => undefined } },
} satisfies Meta<typeof CrmOpportunityMoveSheet>
export default meta
type Story = StoryObj<typeof meta>
export const Sale: Story = {}
export const Lost: Story = { args: { move: { item, to: 'lost', revert: () => undefined } } }
export const PickStage: Story = { args: { move: { item, to: 'pick', revert: () => undefined } } }
export const Pending: Story = { args: { pending: true } }
export const Refused: Story = { args: { error: 'تغيّر هذا السجل أو أُغلق. حدّث الصفحة ثم أعد المحاولة.' } }
