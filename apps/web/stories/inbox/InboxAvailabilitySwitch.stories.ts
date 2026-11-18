import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse } from 'msw'
import InboxAvailabilitySwitch from '../../app/components/inbox/InboxAvailabilitySwitch.vue'
import { me } from '../fixtures/pmo'
import { storyContext } from '../support/context'

const access = http.get('/api/v1/me', () => HttpResponse.json({ ...me, capabilities: ['inbox.conversations.read', 'inbox.conversations.reply'] }))
const agents = (self: Record<string, unknown>) => http.get('/api/v1/inbox/agents', () => HttpResponse.json({
  items: [{ id: 99, name: 'منى', available: true, in_shift: true, effective_available: true }, { id: me.id, name: me.name, ...self }],
  total: 2,
}))

const meta = {
  title: 'Inbox/InboxAvailabilitySwitch',
  component: InboxAvailabilitySwitch,
  parameters: {
    layout: 'padded',
    ...storyContext('apps/web/app/components/inbox/InboxWorkspace.vue:74', 'مفتاح حالة الموظف في رأس صندوق الوارد: متاح أو غير متاح لاستلام المحادثات الجديدة. يظهر لمن يملك صلاحية الرد فقط، ويسمّي الحالة الفعلية: متاح، غير متاح، أو خارج الدوام.'),
  },
} satisfies Meta<typeof InboxAvailabilitySwitch>
export default meta
type Story = StoryObj<typeof meta>

export const Available: Story = { name: 'متاح', parameters: { msw: { handlers: { api: [access, agents({ available: true, in_shift: true, effective_available: true })] } } } }
export const Unavailable: Story = { name: 'غير متاح', parameters: { msw: { handlers: { api: [access, agents({ available: false, in_shift: true, effective_available: false })] } } } }
export const OffShift: Story = { name: 'خارج الدوام', parameters: { msw: { handlers: { api: [access, agents({ available: true, in_shift: false, effective_available: false })] } } } }
