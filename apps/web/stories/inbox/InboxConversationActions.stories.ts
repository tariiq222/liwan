import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse } from 'msw'
import InboxConversationActions from '../../app/components/inbox/InboxConversationActions.vue'
import { me } from '../fixtures/pmo'
import { storyContext } from '../support/context'

const access = http.get('/api/v1/me', () => HttpResponse.json({ ...me, capabilities: ['inbox.conversations.read', 'inbox.conversations.reply', 'inbox.conversations.assign'] }))
const conversation = {
  id: 3, revision: 1, can_reply: true, can_assign: true, assignee: null, state: 'open', priority: 'normal',
}

const meta = {
  title: 'Inbox/InboxConversationActions',
  component: InboxConversationActions,
  parameters: {
    layout: 'padded',
    ...storyContext('apps/web/app/components/inbox/InboxWorkspace.vue:137', 'إجراءات المحادثة في رأس الخيط: إسناد لي، حل المحادثة أو إعادة فتحها، وقائمة الأولوية وإلغاء الإسناد. الزر الذي لا يملك المستخدم صلاحيته لا يُرسم، وتحت 768px يصير الزران أيقونتين.'),
    msw: { handlers: { api: [access] } },
  },
  args: { conversation },
} satisfies Meta<typeof InboxConversationActions>
export default meta
type Story = StoryObj<typeof meta>

export const Open: Story = { name: 'محادثة مفتوحة' }
export const AssignedToOther: Story = { name: 'مسندة لغيري', args: { conversation: { ...conversation, assignee: { user_id: 99, id: 99, name: 'منى' } } as never } }
export const Resolved: Story = { name: 'محلولة', args: { conversation: { ...conversation, state: 'resolved' } as never } }
export const ReplyOnly: Story = { name: 'بلا حق الإسناد', args: { conversation: { ...conversation, can_assign: false } as never } }
export const ReadOnly: Story = { name: 'قراءة فقط', args: { conversation: { ...conversation, can_reply: false, can_assign: false } as never } }
