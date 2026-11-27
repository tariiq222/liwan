import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse } from 'msw'
import HelpdeskStagesSection from '../../app/components/helpdesk/settings/HelpdeskStagesSection.vue'
import { storyContext } from '../support/context'
import { stageRows, teamRows } from './helpdeskFixtures'

const save = http.post('/api/v1/helpdesk/settings/stages', async ({ request }) => {
  const body = await request.json() as { id?: number, name: string, sequence?: number, team_ids?: number[] }
  const saved = stageRows.find(stage => stage.id === body.id)
  return HttpResponse.json({
    ...(saved ?? { id: 16, active: true, closed: false, unattended: false, fold: false, shared: false }),
    ...body,
    team_ids: body.team_ids ?? saved?.team_ids ?? [],
  })
})

const meta = {
  title: 'Helpdesk/HelpdeskStagesSection',
  component: HelpdeskStagesSection,
  parameters: {
    layout: 'padded',
    ...storyContext('apps/web/app/pages/settings/apps/helpdesk/index.vue:50', 'مراحل الدعم بدلالاتها (مغلقة، بانتظار العميل، مطوية) وروابط إلى لوحة الإنشاء وصفحة التعديل ومفتاح أرشفة؛ ومرحلة المحرّك المشتركة موسومة وتبقى للقراءة فقط.'),
    msw: { handlers: { api: [save] } },
  },
  args: { rows: stageRows, teams: teamRows, canEdit: true },
} satisfies Meta<typeof HelpdeskStagesSection>
export default meta
type Story = StoryObj<typeof meta>

export const Stages: Story = { name: 'مراحل' }
export const ReadOnly: Story = { name: 'عرض فقط', args: { canEdit: false } }
export const Empty: Story = { name: 'لا مراحل', args: { rows: [] } }
export const NoTeams: Story = { name: 'بلا فرق', args: { teams: [] } }
