import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse } from 'msw'
import BranchStrictCard from '../../app/components/access/branches/BranchStrictCard.vue'
import PageContainer from '@liwan/ui/app/components/shared/layout/PageContainer.vue'
import { storyContext } from '../support/context'

const handler = (scope: string, enabled: boolean) => [
  http.get(`/api/v1/hr/payroll/branch-strictness`, () => HttpResponse.json({ scope, enabled })),
  http.patch(`/api/v1/hr/payroll/branch-strictness`, async ({ request }) => HttpResponse.json({ scope, ...(await request.json() as { enabled: boolean }) })),
]
const meta = {
  title: 'Access/BranchStrictCard', component: BranchStrictCard,
  parameters: { layout: 'fullscreen', ...storyContext('apps/web/app/pages/settings/apps/hr/index.vue:130'), msw: { handlers: { strict: handler('payroll', false) } } },
  args: { scope: 'payroll', path: '/api/v1/hr/payroll/branch-strictness', canRead: true, canEdit: true },
  render: args => ({ components: { BranchStrictCard, PageContainer }, setup: () => ({ args }), template: '<main class="liwan-shell-main"><PageContainer width="form"><BranchStrictCard v-bind="args" /></PageContainer></main>' }),
} satisfies Meta<typeof BranchStrictCard>
export default meta
type Story = StoryObj<typeof meta>
export const Off: Story = {}
export const On: Story = { parameters: { msw: { handlers: { strict: handler('payroll', true) } } } }
export const ViewOnly: Story = { args: { canEdit: false }, parameters: { msw: { handlers: { strict: handler('payroll', true) } } } }
