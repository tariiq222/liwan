import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse } from 'msw'
import CompanyMembers from '../../app/components/access/users/CompanyMembers.vue'
import PageContainer from '@liwan/ui/app/components/shared/layout/PageContainer.vue'
import { shellHandlers } from '../handlers/shell'
import { emptyMembershipList, memberRoles, membershipList, membersMe, membersReaderMe } from '../fixtures/memberships'
import { storyContext } from '../support/context'

const handlers = (me: unknown, list: unknown) => ({ msw: { handlers: { api: [
  http.get('/api/v1/me', () => HttpResponse.json(me)),
  http.get('/api/v1/admin/memberships', () => HttpResponse.json(list)),
  ...shellHandlers,
] } } })
const meta = {
  title: 'Access/CompanyMembers', component: CompanyMembers,
  parameters: { layout: 'fullscreen', ...handlers(membersMe, membershipList), ...storyContext('apps/web/app/pages/settings/team/users/index.vue:132') },
  args: { roles: memberRoles },
  render: args => ({ components: { CompanyMembers, PageContainer }, setup: () => ({ args }), template: '<main class="liwan-shell-main"><PageContainer><CompanyMembers v-bind="args" /></PageContainer></main>' }),
} satisfies Meta<typeof CompanyMembers>
export default meta
type Story = StoryObj<typeof meta>
export const Filled: Story = { name: 'أعضاء من شركات أخرى' }
export const Empty: Story = { name: 'لا أعضاء', parameters: handlers(membersMe, emptyMembershipList) }
export const RemoveOnly: Story = { name: 'بلا صلاحية تغيير الأدوار', parameters: handlers(membersReaderMe, membershipList) }
export const Branch: Story = { name: 'عضو فرع تحت الشركة الجذر', args: { companyId: 2 } }
