import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { fn } from 'storybook/test'
import CrmOpportunityConversations from '../../../app/components/crm/opportunity/CrmOpportunityConversations.vue'
import { storyContext } from '../../support/context'

const base = {
  contact: { id: 4, name: 'منى العتيبي', phone: '+966500000001', email: null, erased: false },
  channel: { id: 1, name: 'واتساب الرياض', kind: 'whatsapp' },
  department: null, assignee: null, priority: 'normal', tags: [], revision: 1, reply_window_ends_at: null, waiting_since: null, waiting_overdue: false, csat: null, referral_source: null, referral_ref: null, last_message_kind: 'text',
} as const
const conversations = [
  { ...base, id: 12, state: 'open', unread: true, last_message_at: '2026-11-14T10:00:00Z', last_message_preview: 'أريد عرض سعر للباقة المتقدمة' },
  { ...base, id: 13, state: 'resolved', unread: false, channel: { id: 2, name: 'تيك توك', kind: 'tiktok' }, last_message_at: '2026-11-10T08:30:00Z', last_message_preview: 'شكرًا لكم' },
] as const

const meta = {
  title: 'CRM/CrmOpportunityConversations',
  component: CrmOpportunityConversations,
  parameters: storyContext('apps/web/app/pages/crm/opportunities/[id].vue:388', 'محادثات العملاء المرتبطة بالفرصة (جسر مع الرسائل): القناة والحالة وآخر رسالة مع رابط المحادثة في الرسائل. للقراءة فقط.'),
  args: { conversations: [...conversations], total: conversations.length, onRetry: fn() },
} satisfies Meta<typeof CrmOpportunityConversations>
export default meta
type Story = StoryObj<typeof meta>

export const WithConversations: Story = { name: 'مع محادثات' }
export const Empty: Story = { name: 'فارغ', args: { conversations: [], total: 0 } }
export const Loading: Story = { name: 'جارٍ التحميل', args: { conversations: [], total: 0, loading: true } }
