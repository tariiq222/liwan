import type { Meta, StoryObj } from '@storybook/vue3-vite'
import MemberRolesForm from '../../app/components/access/users/MemberRolesForm.vue'
import PageContainer from '@liwan/ui/app/components/shared/layout/PageContainer.vue'
import { shellHandlers } from '../handlers/shell'
import { memberRoles, membershipList } from '../fixtures/memberships'
import { storyContext } from '../support/context'

const meta = {
  title: 'Access/MemberRolesForm', component: MemberRolesForm,
  parameters: { layout: 'fullscreen', msw: { handlers: { api: shellHandlers } }, ...storyContext('apps/web/app/pages/settings/team/members/[memberId]/edit.vue:52') },
  args: { member: membershipList.items[0]!, roles: memberRoles, reloadMember: async () => {} },
  render: args => ({ components: { MemberRolesForm, PageContainer }, setup: () => ({ args }), template: '<main class="liwan-shell-main"><PageContainer><MemberRolesForm v-bind="args" /></PageContainer></main>' }),
} satisfies Meta<typeof MemberRolesForm>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = { name: 'أدوار عضو' }
export const NoRoles: Story = { name: 'بلا أدوار محفوظة', args: { member: membershipList.items[1]! } }
