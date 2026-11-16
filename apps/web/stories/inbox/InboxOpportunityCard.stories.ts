import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse } from 'msw'
import InboxOpportunityCard from '../../app/components/inbox/InboxOpportunityCard.vue'
import { me } from '../fixtures/pmo'
import { storyContext } from '../support/context'

const access = http.get('/api/v1/me', () => HttpResponse.json({ ...me, capabilities: ['crm.leads.read', 'crm.leads.work', 'inbox.conversations.read', 'inbox.conversations.reply'] }))
const linked = { id: 9, contact_name: 'منى العتيبي', stage: { id: 2, name: 'تم التواصل' }, status: 'pending', active: true }
const answer = (body: unknown) => ({ parameters: { msw: { handlers: { api: [access, http.get('/api/v1/inbox/conversations/3/opportunity', () => HttpResponse.json(body))] } } } })

const meta = {
  title: 'Inbox/InboxOpportunityCard',
  component: InboxOpportunityCard,
  parameters: {
    layout: 'padded',
    ...storyContext('apps/web/app/components/inbox/InboxContactPanel.vue:133', 'فرصة المبيعات المرتبطة بالمحادثة: الاسم والمرحلة والحالة مع رابط الفرصة وفصلها، أو ربط فرصة موجودة (بحث برقم جهة الاتصال أولًا ثم بالاسم). لا تُنشأ فرصة من هنا.'),
    ...answer(null).parameters,
  },
  args: { conversationId: 3, contactPhone: '+966500000001', canReply: true },
} satisfies Meta<typeof InboxOpportunityCard>
export default meta
type Story = StoryObj<typeof meta>

export const NotLinked: Story = { name: 'غير مرتبطة' }
export const Linked: Story = { name: 'مرتبطة', parameters: answer(linked).parameters }
export const Archived: Story = { name: 'فرصة مؤرشفة', parameters: answer({ ...linked, active: false }).parameters }
export const Won: Story = { name: 'فرصة مُباعة', parameters: answer({ ...linked, status: 'won' }).parameters }
export const ReplyLocked: Story = { name: 'بلا حق الرد', args: { canReply: false } }
