import type { Meta, StoryObj } from '@storybook/vue3-vite'
import CrmOpportunitySaleForm from '../../../app/components/crm/opportunity/CrmOpportunitySaleForm.vue'
import { storyContext } from '../../support/context'
import { packages } from './crmOpportunityFixtures'

const meta = {
  title: 'CRM/CrmOpportunitySaleForm',
  component: CrmOpportunitySaleForm,
  parameters: storyContext('apps/web/app/pages/crm/opportunities/[id].vue:180', 'حقول البيع: الباقة والسعر النهائي، والخصم يُحسب ولا يُكتب.'),
  args: { packages, modelValue: { package_id: null, final_price: null } },
} satisfies Meta<typeof CrmOpportunitySaleForm>
export default meta
type Story = StoryObj<typeof meta>
export const Empty: Story = {}
export const Discounted: Story = { args: { modelValue: { package_id: 2, final_price: 250 } } }
export const MissingFields: Story = { args: { showErrors: true } }
