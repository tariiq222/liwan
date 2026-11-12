import type { Meta, StoryObj } from '@storybook/vue3-vite'
import MemberAddForm from '../../app/components/access/users/MemberAddForm.vue'
import PageContainer from '@liwan/ui/app/components/shared/layout/PageContainer.vue'
import { shellHandlers } from '../handlers/shell'
import { memberRoles } from '../fixtures/memberships'
import { storyContext } from '../support/context'

const meta = {
  title: 'Access/MemberAddForm', component: MemberAddForm,
  parameters: { layout: 'fullscreen', msw: { handlers: { api: shellHandlers } }, ...storyContext('apps/web/app/components/access/branches/BranchMembersCard.vue:32') },
  args: { companyId: 2, roles: memberRoles },
  render: args => ({ components: { MemberAddForm, PageContainer }, setup: () => ({ args }), template: '<main class="liwan-shell-main"><PageContainer><MemberAddForm v-bind="args" /></PageContainer></main>' }),
} satisfies Meta<typeof MemberAddForm>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = { name: 'إضافة عضو إلى فرع' }
export const NoRoles: Story = { name: 'فرع بلا أدوار متاحة', args: { roles: [] } }
