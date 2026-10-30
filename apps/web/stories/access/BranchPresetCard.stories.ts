import type { Meta, StoryObj } from '@storybook/vue3-vite'
import type { BranchPolicy } from '@liwan/contracts'
import BranchPresetCard from '../../app/components/access/branches/BranchPresetCard.vue'
import PageContainer from '@liwan/ui/app/components/shared/layout/PageContainer.vue'
import { storyContext } from '../support/context'

const roles = [
  { id: 1, key: 'employee', name: { ar: 'موظف', en: 'Employee' }, company_id: null, active: true },
  { id: 2, key: 'hr_manager', name: { ar: 'مدير الموارد البشرية', en: 'HR manager' }, company_id: null, active: true },
  { id: 3, key: 'finance_manager', name: { ar: 'مدير المالية', en: 'Finance manager' }, company_id: null, active: true },
]
const branches = [{ id: 2, name: 'فرع الرياض', inherit: false, role_ids: [] }, { id: 3, name: 'فرع جدة', inherit: false, role_ids: [] }]
const policy = (preset: BranchPolicy['preset'], rows = branches): BranchPolicy => ({
  version: 'b1-v2', mode: 'delegated', preset, strict_scopes: [], branches: rows, roles,
})
const meta = {
  title: 'Access/BranchPresetCard', component: BranchPresetCard,
  parameters: { layout: 'fullscreen', ...storyContext('apps/web/app/pages/settings/team/branches.vue:27') },
  args: { policy: policy('independent_branches'), reloadPolicy: async () => policy('independent_branches') },
  render: args => ({ components: { BranchPresetCard, PageContainer }, setup: () => ({ args }), template: '<main class="liwan-shell-main"><PageContainer width="form"><BranchPresetCard v-bind="args" /></PageContainer></main>' }),
} satisfies Meta<typeof BranchPresetCard>
export default meta
type Story = StoryObj<typeof meta>
export const IndependentBranches: Story = {}
export const CentralBranches: Story = { args: { policy: policy('central_branches') } }
export const GroupOfCompanies: Story = { args: { policy: policy('group_of_companies') } }
export const SingleCompany: Story = { args: { policy: policy('single_company', []) } }
export const Custom: Story = { args: { policy: policy('custom') } }
