import type { Meta, StoryObj } from '@storybook/vue3-vite'
import InboxFlowPreview from '../../app/components/inbox/InboxFlowPreview.vue'
import { emptyField, emptyOption, emptyScreen, flowPreviewModel, type FlowDraft, type FlowFieldDraft } from '../../app/composables/inbox/inboxFlow'
import { storyContext } from '../support/context'

const field = (kind: FlowFieldDraft['kind'], extra: Partial<FlowFieldDraft>): FlowFieldDraft => ({ ...emptyField(kind), ...extra })
const screen = (title: string, footerLabel: string, fields: FlowFieldDraft[]) => ({ ...emptyScreen(title, footerLabel), fields })

const appointment: FlowDraft = {
  name: 'طلب موعد', category: 'appointment_booking', language: 'ar', completionMessage: '',
  screens: [
    screen('بياناتك', 'التالي', [
      field('heading', { text: 'أخبرنا عن نفسك' }),
      field('text_input', { key: 'full_name', label: 'الاسم الكامل', helperText: 'كما في الهوية' }),
      field('text_input', { key: 'phone', label: 'رقم الجوال', inputType: 'phone' }),
    ]),
    screen('تفاصيل الموعد', 'إرسال', [
      field('dropdown', { key: 'service', label: 'نوع الخدمة', options: [emptyOption('كشف'), emptyOption('متابعة', 'لمراجعين سابقين'), emptyOption('استشارة')] }),
      field('date', { key: 'preferred_date', label: 'التاريخ المفضل' }),
      field('radio', { key: 'period', label: 'الفترة', options: [emptyOption('صباحًا'), emptyOption('مساءً')] }),
      field('checkbox', { key: 'extras', label: 'خدمات إضافية', required: false, options: [emptyOption('تحاليل'), emptyOption('أشعة')] }),
      field('caption', { text: 'سنؤكد الموعد خلال ساعات العمل.' }),
      field('opt_in', { key: 'consent', label: 'أوافق على التواصل معي', required: false }),
    ]),
  ],
}

const meta = {
  title: 'Inbox/InboxFlowPreview',
  component: InboxFlowPreview,
  args: { model: flowPreviewModel(appointment) },
} satisfies Meta<typeof InboxFlowPreview>
export default meta
type Story = StoryObj<typeof meta>

export const BuilderSideBySide: Story = {
  name: 'بجانب المنشئ (شاشتان)',
  parameters: storyContext('apps/web/app/components/inbox/InboxFlowBuilder.vue:147'),
  render: args => ({
    components: { InboxFlowPreview },
    setup: () => ({ args }),
    template: '<div class="max-w-xs"><InboxFlowPreview :model="args.model" /></div>',
  }),
}

export const SecondScreen: Story = {
  name: 'الشاشة الثانية',
  parameters: storyContext('apps/web/app/components/inbox/InboxFlowBuilder.vue:147'),
  render: args => ({
    components: { InboxFlowPreview },
    setup: () => ({ args }),
    template: '<div class="max-w-xs"><InboxFlowPreview :model="args.model" :screen="1" /></div>',
  }),
}

export const EnglishLtr: Story = {
  name: 'نموذج إنجليزي (اتجاه يسار لليمين)',
  parameters: storyContext('apps/web/app/components/inbox/InboxFlowBuilder.vue:147', 'اتجاه المعاينة يتبع لغة النموذج لا لغة الصفحة.'),
  render: () => ({
    components: { InboxFlowPreview },
    setup: () => ({
      model: flowPreviewModel({
        name: 'Feedback', category: 'survey', language: 'en', completionMessage: '',
        screens: [screen('Your feedback', 'Submit', [field('text_area', { key: 'comment', label: 'Comment', helperText: 'Tell us more' }), field('opt_in', { key: 'consent', label: 'You may contact me', required: false })])],
      }),
    }),
    template: '<div class="max-w-xs"><InboxFlowPreview :model="model" /></div>',
  }),
}

export const UnfinishedDraft: Story = {
  name: 'مسودة غير مكتملة',
  parameters: storyContext('apps/web/app/components/inbox/InboxFlowBuilder.vue:147', 'ما لم يُكتب بعد يظهر علامة …، والمعاينة لا تتحقق من الصحة.'),
  render: () => ({
    components: { InboxFlowPreview },
    setup: () => ({ model: flowPreviewModel({ name: '', category: 'other', language: 'ar', completionMessage: '', screens: [screen('', '', [field('text_input', { key: 'field_1' }), field('dropdown', { key: 'field_2' })])] }) }),
    template: '<div class="max-w-xs"><InboxFlowPreview :model="model" /></div>',
  }),
}
