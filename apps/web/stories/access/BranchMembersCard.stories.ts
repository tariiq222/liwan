import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse } from 'msw'
import BranchMembersCard from '../../app/components/access/branches/BranchMembersCard.vue'
import PageContainer from '@liwan/ui/app/components/shared/layout/PageContainer.vue'
import { shellHandlers } from '../handlers/shell'
import { emptyMembershipList, memberRoles, membershipList, membersMe } from '../fixtures/memberships'
import { storyContext } from '../support/context'

const handlers = (list: unknown) => ({ msw: { handlers: { api: [
  http.get('/api/v1/me', () => HttpResponse.json(membersMe)),
  http.get('/api/v1/admin/memberships', () => HttpResponse.json(list)),
  ...shellHandlers,
] } } })
const open = async ({ canvasElement }: { canvasElement: HTMLElement }) => {
  canvasElement.querySelector<HTMLButtonElement>('[data-testid="branch-members-toggle"]')?.click()
}
const meta = {
  title: 'Access/BranchMembersCard', component: BranchMembersCard,
  parameters: { layout: 'fullscreen', ...handlers(membershipList), ...storyContext('apps/web/app/pages/settings/team/branches.vue:156') },
  args: { branch: { id: 2, name: 'فرع الرياض' }, roles: memberRoles },
  render: args => ({ components: { BranchMembersCard, PageContainer }, setup: () => ({ args }), template: '<main class="liwan-shell-main"><PageContainer><ul><BranchMembersCard v-bind="args" /></ul></PageContainer></main>' }),
} satisfies Meta<typeof BranchMembersCard>
export default meta
type Story = StoryObj<typeof meta>
export const Closed: Story = { name: 'فرع مغلق' }
export const OpenWithMembers: Story = { name: 'مفتوح، له أعضاء', play: open }
export const OpenEmptyBranch: Story = { name: 'فرع جديد بلا أعضاء', parameters: handlers(emptyMembershipList), play: open }
