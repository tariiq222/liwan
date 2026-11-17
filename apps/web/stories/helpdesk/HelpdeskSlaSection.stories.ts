import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse } from 'msw'
import HelpdeskSlaSection from '../../app/components/helpdesk/settings/HelpdeskSlaSection.vue'
import { storyContext } from '../support/context'
import { categoryRows, slaPolicies, stageRows, tagRows, teamRows } from './helpdeskFixtures'

// A save answers the whole policy; the archive switch answers the policy it turned off.
const save = http.post('/api/v1/helpdesk/sla', async ({ request }) => {
  const body = await request.json() as { id?: number }
  const saved = slaPolicies.find(policy => policy.id === body.id)
  return HttpResponse.json({
    ...(saved ?? { id: 84, active: true, ticket_count: 0, team_ids: [], category_ids: [], tag_ids: [], ignore_stage_ids: [] }),
    ...body,
  })
})
const archive = http.post('/api/v1/helpdesk/sla/:id/active', ({ params }) => {
  const saved = slaPolicies.find(policy => policy.id === Number(params.id))!
  return HttpResponse.json(saved)
})

const meta = {
  title: 'Helpdesk/HelpdeskSlaSection',
  component: HelpdeskSlaSection,
  parameters: {
    layout: 'padded',
    ...storyContext('apps/web/app/pages/settings/apps/helpdesk/index.vue:168', 'اتفاقيات مستوى الخدمة: المرحلة المستهدفة لكل اتفاقية، وأيامها وساعاتها، والفرق والتصنيفات والوسوم التي تسري عليها، والمراحل التي توقف الساعة؛ تُعدَّل في مكانها بمفتاح أرشفة.'),
    msw: { handlers: { api: [save, archive] } },
  },
  args: { rows: slaPolicies, stages: stageRows, teams: teamRows, categories: categoryRows, tags: tagRows, canEdit: true },
} satisfies Meta<typeof HelpdeskSlaSection>
export default meta
type Story = StoryObj<typeof meta>

export const Policies: Story = { name: 'اتفاقيات' }
export const ReadOnly: Story = { name: 'عرض فقط', args: { canEdit: false } }
export const Empty: Story = { name: 'لا اتفاقيات', args: { rows: [] } }
export const NoCatalogs: Story = { name: 'بلا مراحل ولا فرق', args: { stages: [], teams: [], categories: [], tags: [] } }
