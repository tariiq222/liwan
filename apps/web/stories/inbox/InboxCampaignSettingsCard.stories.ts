import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse } from 'msw'
import type { InboxCampaignSettings } from '@liwan/contracts'
import InboxCampaignSettingsCard from '../../app/components/inbox/campaigns/InboxCampaignSettingsCard.vue'
import { me } from '../fixtures/pmo'
import { storyContext } from '../support/context'

const settings: InboxCampaignSettings = {
  consent_policy: 'opted_in_only', default_country_code: '966', keyword_opt_out: true, stop_keywords: ['stop', 'إيقاف'], start_keywords: ['start'],
  stop_reply: 'تم إيقاف رسائلنا التسويقية.', start_reply: null, default_daily_cap: 0,
}
const manage = http.get('/api/v1/me', () => HttpResponse.json({ ...me, capabilities: ['inbox.campaigns.manage'] }))
const save = http.patch('/api/v1/settings/inbox/campaigns', async ({ request }) => HttpResponse.json({ ...settings, ...(await request.json() as object) }))
const refuse = (status: number, body: object) => ({ parameters: { msw: { handlers: { api: [manage, http.patch('/api/v1/settings/inbox/campaigns', () => HttpResponse.json(body, { status }))] } } } })

const meta = {
  title: 'Inbox/InboxCampaignSettingsCard',
  component: InboxCampaignSettingsCard,
  parameters: {
    ...storyContext('apps/web/app/pages/settings/apps/inbox.vue:61', 'سياسة حملات الرسائل: من يجوز مراسلته، ورمز الدولة الافتراضي، وكلمات الإيقاف والاستئناف وردودها، والحد اليومي لكل حملة جديدة. تُحفظ من شريط الحفظ الواحد للصفحة.'),
    msw: { handlers: { api: [manage, save] } },
  },
  args: { settings, canEdit: true, reloadSettings: async () => settings },
} satisfies Meta<typeof InboxCampaignSettingsCard>
export default meta
type Story = StoryObj<typeof meta>

export const Editable: Story = {}
export const KeywordsOff: Story = { args: { settings: { ...settings, keyword_opt_out: false } } }
export const ReadOnly: Story = { args: { canEdit: false } }
export const Refused: Story = refuse(422, { code: 'invalid', message: 'تعذّر حفظ السياسة.' })
export const Conflict: Story = refuse(409, { code: 'conflict', message: 'Settings changed; reload before saving' })
