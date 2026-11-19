import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse } from 'msw'
import InboxChannelOpportunityMode from '../../app/components/inbox/InboxChannelOpportunityMode.vue'
import { me } from '../fixtures/pmo'
import { storyContext } from '../support/context'

const access = http.get('/api/v1/me', () => HttpResponse.json({ ...me, capabilities: ['inbox.channels.manage', 'crm.settings.manage'] }))
const setting = (mode: string) => ({ parameters: { msw: { handlers: { api: [
  access,
  http.get('/api/v1/inbox/channels/4/crm-settings', () => HttpResponse.json({ channel_id: 4, opportunity_mode: mode })),
  http.patch('/api/v1/inbox/channels/4/crm-settings', async ({ request }) => HttpResponse.json({ channel_id: 4, ...(await request.json() as object) })),
] } } } })

const meta = {
  title: 'Inbox/InboxChannelOpportunityMode',
  component: InboxChannelOpportunityMode,
  parameters: {
    layout: 'padded',
    ...storyContext('apps/web/app/pages/settings/apps/inbox/channels/[id]/index.vue:173', 'إعداد القناة الذي يحدد هل تفتح أول رسالة في محادثة جديدة فرصة مبيعات تلقائيًا أم يدويًا. يظهر لمن يدير القناة وإعدادات المبيعات فقط وحين يكون تطبيق المبيعات مفعّلًا.'),
    ...setting('manual').parameters,
  },
  args: { channelId: 4 },
} satisfies Meta<typeof InboxChannelOpportunityMode>
export default meta
type Story = StoryObj<typeof meta>

export const Manual: Story = { name: 'يدوي' }
export const Automatic: Story = { name: 'تلقائي عند أول رسالة', parameters: setting('auto_first_message').parameters }
