import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse } from 'msw'
import HelpdeskTeamsSection from '../../app/components/helpdesk/settings/HelpdeskTeamsSection.vue'
import { storyContext } from '../support/context'
import { teamRows } from './helpdeskFixtures'

// The member picker searches `/api/v1/people`; a save answers the whole saved team, as the server does.
const members = [{ id: 7, name: 'سارة القحطاني' }, { id: 9, name: 'محمد العتيبي' }, { id: 4, name: 'خالد الحربي' }]
const people = http.get('/api/v1/people', () => HttpResponse.json(members.map(member => ({ ...member, user_id: member.id }))))
const save = http.post('/api/v1/helpdesk/settings/teams', async ({ request }) => {
  const body = await request.json() as { id?: number, name: string, member_ids?: number[], leader_id?: number | null }
  const saved = teamRows.find(team => team.id === body.id)
  return HttpResponse.json({
    ...(saved ?? { id: 4, active: true, sequence: 40, calendar_id: null }),
    ...body,
    member_ids: (body.member_ids ?? saved?.member_ids.map(member => member.id) ?? []).map(id => members.find(member => member.id === id)!),
    leader_id: body.leader_id ?? saved?.leader_id ?? null,
  })
})

const meta = {
  title: 'Helpdesk/HelpdeskTeamsSection',
  component: HelpdeskTeamsSection,
  parameters: {
    layout: 'padded',
    ...storyContext('apps/web/app/pages/settings/apps/helpdesk/index.vue:148', 'فرق الدعم في الإعدادات: اسم كل فريق وقائده وأعضائه، ونموذج مضمّن يُحفظ كاملًا، ومفتاح أرشفة يرفضه الخادم ما دام الفريق يحمل تذاكر مفتوحة.'),
    msw: { handlers: { api: [people, save] } },
  },
  args: { rows: teamRows, canEdit: true },
} satisfies Meta<typeof HelpdeskTeamsSection>
export default meta
type Story = StoryObj<typeof meta>

export const Teams: Story = { name: 'فرق' }
export const ReadOnly: Story = { name: 'عرض فقط', args: { canEdit: false } }
export const Empty: Story = { name: 'لا فرق', args: { rows: [] } }
