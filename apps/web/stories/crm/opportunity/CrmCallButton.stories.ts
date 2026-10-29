import type { Meta, StoryObj } from '@storybook/vue3-vite'
import CrmCallButton from '../../../app/components/crm/opportunity/CrmCallButton.vue'
import { storyContext } from '../../support/context'

const meta = {
  title: 'CRM/CrmCallButton',
  component: CrmCallButton,
  parameters: storyContext('apps/web/app/components/crm/opportunity/CrmOpportunityBoard.vue:35', 'زر اتصال دائري بجانب بطاقة الفرصة، يفتح tel: ولا يفتح البطاقة.'),
  args: { phone: '+966501234567', name: 'أحمد العتيبي' },
} satisfies Meta<typeof CrmCallButton>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {}
