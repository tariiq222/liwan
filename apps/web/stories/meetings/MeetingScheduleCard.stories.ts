import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse, delay } from 'msw'
import type { MeetingSettings } from '@liwan/contracts'
import MeetingScheduleCard from '../../app/components/meetings/MeetingScheduleCard.vue'
import { me } from '../fixtures/pmo'
import { storyContext } from '../support/context'

const settings: MeetingSettings = {
  values: { schedule_policy: 'organizers_only' },
  defaults: { schedule_policy: 'organizers_only' },
  options: { schedule_policy: ['all_employees', 'organizers_only'] },
  revision: 3,
}
const changedElsewhere: MeetingSettings = { ...settings, values: { schedule_policy: 'all_employees' }, revision: 4 }
const manage = http.get('/api/v1/me', () => HttpResponse.json({ ...me, capabilities: ['meetings.settings.manage'] }))
const save = http.patch('/api/v1/meetings/settings', async ({ request }) => {
  const body = await request.json() as { values: MeetingSettings['values'] }
  return HttpResponse.json({ ...settings, values: body.values, revision: 4 })
})
const refuse = (status: number, body: object) => ({ parameters: { msw: { handlers: { api: [manage, http.patch('/api/v1/meetings/settings', () => HttpResponse.json(body, { status }))] } } } })

const meta = {
  title: 'Meetings/MeetingScheduleCard',
  component: MeetingScheduleCard,
  parameters: {
    layout: 'padded',
    ...storyContext('apps/web/app/pages/settings/apps/meetings/index.vue:25', 'من يجدول الاجتماعات في الشركة: كل الموظفين أو أصحاب دور منظّم الاجتماعات فقط، يُحفظ مع رقم المراجعة ويُعاد التحميل عند التعارض.'),
    msw: { handlers: { api: [manage, save] } },
  },
  args: { settings, reloadSettings: async () => changedElsewhere },
} satisfies Meta<typeof MeetingScheduleCard>
export default meta
type Story = StoryObj<typeof meta>

export const OrganizersOnly: Story = {}
export const AllEmployees: Story = { args: { settings: changedElsewhere } }
export const Saving: Story = { parameters: { msw: { handlers: { api: [manage, http.patch('/api/v1/meetings/settings', async () => { await delay(10_000); return HttpResponse.json({ ...settings, revision: 4 }) })] } } } }
export const SaveError: Story = refuse(503, { code: 'unavailable', message: 'تعذّر حفظ الإعدادات الآن' })
export const Conflict: Story = refuse(409, { code: 'conflict', message: 'Meetings settings changed; reload before saving' })
export const ReloadFails: Story = { ...refuse(409, { code: 'conflict', message: 'Meetings settings changed; reload before saving' }), args: { reloadSettings: async () => { throw new Error('offline') } } }
