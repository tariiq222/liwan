import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { ref } from 'vue'
import BranchRoleAssignments from '../../app/components/access/branches/BranchRoleAssignments.vue'
import PageContainer from '@liwan/ui/app/components/shared/layout/PageContainer.vue'
import { storyContext } from '../support/context'
const meta = {
  title: 'Access/BranchRoleAssignments', component: BranchRoleAssignments,
  parameters: { layout: 'fullscreen' },
  args: {
    modelValue: [{ id: 2, name: 'فرع الرياض', inherit: true, role_ids: [4] }, { id: 3, name: 'فرع جدة', inherit: false, role_ids: [] }],
    roles: [{ id: 4, key: 'finance_reader', name: { ar: 'قارئ المالية', en: 'Finance reader' } }, { id: 5, key: 'hr_manager', name: { ar: 'مدير الموارد البشرية', en: 'HR manager' } }],
    inherited: true, disabled: false,
  },
} satisfies Meta<typeof BranchRoleAssignments>
export default meta
type Story = StoryObj<typeof meta>
export const Inherited: Story = {
  parameters: storyContext('apps/web/app/components/access/branches/BranchPolicyCard.vue:32'),
  render: args => ({ components: { BranchRoleAssignments, PageContainer }, setup: () => ({ args, branches: ref(args.modelValue) }), template: '<main class="liwan-shell-main"><PageContainer width="form"><BranchRoleAssignments v-bind="args" v-model="branches" /></PageContainer></main>' }),
}
export const Delegated: Story = { ...Inherited, args: { inherited: false } }
export const ReadOnly: Story = { ...Inherited, args: { disabled: true } }
export const Empty: Story = { ...Inherited, args: { modelValue: [] } }
