import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse } from 'msw'
import type { InboxSettings } from '@liwan/contracts'
import InboxPolicyCard from '../../app/components/inbox/InboxPolicyCard.vue'
import { me } from '../fixtures/pmo'
import { storyContext } from '../support/context'

const settings: InboxSettings = {
  visibility_policy: 'department', auto_close_hours: 72, retention_months: 24, assignment_policy: 'manual', first_response_alert_minutes: 0,
  report_retention_months: 36, agent_shifts_enabled: false, unavailable_release: 'keep',
}
const manage = http.get('/api/v1/me', () => HttpResponse.json({ ...me, capabilities: ['inbox.settings.manage'] }))
const save = http.patch('/api/v1/settings/inbox', async ({ request }) => HttpResponse.json({ ...settings, ...(await request.json() as object) }))
const refuse = (status: number, body: object) => ({ parameters: { msw: { handlers: { api: [manage, http.patch('/api/v1/settings/inbox', () => HttpResponse.json(body, { status }))] } } } })

const meta = {
  title: 'Inbox/InboxPolicyCard',
  component: InboxPolicyCard,
  parameters: {
    ...storyContext('apps/web/app/pages/settings/apps/inbox.vue:48', 'سياسات رسائل العملاء على مستوى الشركة: الرؤية والإغلاق التلقائي والاحتفاظ وتوزيع المحادثات وتنبيه أول رد. تُحفظ من شريط الحفظ الواحد للصفحة.'),
    msw: { handlers: { api: [manage, save] } },
  },
  args: { settings, canEdit: true, reloadSettings: async () => settings },
} satisfies Meta<typeof InboxPolicyCard>
export default meta
type Story = StoryObj<typeof meta>

export const Editable: Story = {}
export const ReadOnly: Story = { args: { canEdit: false } }
export const Refused: Story = refuse(422, { code: 'invalid', message: 'تعذّر حفظ السياسة.' })
export const Conflict: Story = refuse(409, { code: 'conflict', message: 'Settings changed; reload before saving' })
