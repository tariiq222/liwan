import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { InboxFlowSubmissionSchema } from '@liwan/contracts'
import SubCard from '@liwan/ui/app/components/shared/layout/SubCard.vue'
import InboxFlowSubmissionCard from '../../app/components/inbox/InboxFlowSubmissionCard.vue'
import { storyContext } from '../support/context'

const submission = InboxFlowSubmissionSchema.parse({
  id: 1, flow: { id: 1, name: 'طلب موعد' }, conversation_id: 1, contact: { id: 1, name: 'ليلى القحطاني' }, request_message_id: 40, message_id: 41, submitted_at: '2026-10-29T08:30:00Z',
  answers: [
    { key: 'full_name', label: 'الاسم الكامل', kind: 'text_input', value: 'ليلى القحطاني' },
    { key: 'phone', label: 'رقم الجوال', kind: 'text_input', value: '0500000001' },
    { key: 'service', label: 'نوع الخدمة', kind: 'dropdown', choices: [{ key: 'o2', title: 'متابعة' }] },
    { key: 'extras', label: 'خدمات إضافية', kind: 'checkbox', choices: [{ key: 'o1', title: 'تحاليل' }, { key: 'o2', title: 'أشعة' }] },
    { key: 'preferred_date', label: 'التاريخ المفضل', kind: 'date', value: '2026-11-05' },
    { key: 'consent', label: 'أوافق على التواصل معي', kind: 'opt_in', value: true },
    { key: 'declined', label: 'أوافق على الرسائل الدعائية', kind: 'opt_in', value: false },
  ],
})

const meta = {
  title: 'Inbox/InboxFlowSubmissionCard',
  component: InboxFlowSubmissionCard,
  args: { submission },
} satisfies Meta<typeof InboxFlowSubmissionCard>
export default meta
type Story = StoryObj<typeof meta>

export const InThread: Story = {
  name: 'داخل رسالة العميل',
  parameters: storyContext('apps/web/app/components/inbox/InboxMessageContent.vue:79'),
  render: args => ({
    components: { InboxFlowSubmissionCard, SubCard },
    setup: () => ({ args }),
    template: '<div class="max-w-sm"><SubCard><InboxFlowSubmissionCard :submission="args.submission" /></SubCard></div>',
  }),
}

export const InContactPanel: Story = {
  name: 'في لوحة العميل (مع الوقت ورابط الرسالة)',
  parameters: storyContext('apps/web/app/components/inbox/InboxFlowSubmissionsSection.vue:21'),
  render: args => ({
    components: { InboxFlowSubmissionCard },
    setup: () => ({ args }),
    template: '<div class="max-w-sm rounded-control p-3 ring ring-default"><InboxFlowSubmissionCard :submission="args.submission" show-time link="/inbox/1?message=41" /></div>',
  }),
}

export const UnknownForm: Story = {
  name: 'نموذج غير معروف وإجابات غير مقروءة',
  parameters: storyContext('apps/web/app/components/inbox/InboxMessageContent.vue:79'),
  render: () => ({
    components: { InboxFlowSubmissionCard, SubCard },
    setup: () => ({
      unknown: InboxFlowSubmissionSchema.parse({
        id: 2, flow: null, conversation_id: 1, contact: { id: 1, name: 'ليلى' }, request_message_id: null, message_id: 42, submitted_at: '2026-10-29T09:00:00Z',
        answers: [{ key: 'rating', label: 'rating', kind: 'unknown', value: '5' }, { key: 'comment', label: 'comment', kind: 'unknown', value: '' }],
      }),
    }),
    template: '<div class="max-w-sm"><SubCard><InboxFlowSubmissionCard :submission="unknown" /></SubCard></div>',
  }),
}

export const NoAnswers: Story = {
  name: 'بلا إجابات',
  parameters: storyContext('apps/web/app/components/inbox/InboxMessageContent.vue:79'),
  render: () => ({
    components: { InboxFlowSubmissionCard, SubCard },
    setup: () => ({ empty: { ...submission, answers: [] } }),
    template: '<div class="max-w-sm"><SubCard><InboxFlowSubmissionCard :submission="empty" /></SubCard></div>',
  }),
}
