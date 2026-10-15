import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { fn } from 'storybook/test'
import { ref } from 'vue'
import CommentComposer from '../../app/components/shared/CommentComposer.vue'
import { storyContext } from '../support/context'

// The form keeps no draft and sends nothing: `v-model`, validation and the request are the app's.
const meta = {
  title: 'Shared/CommentComposer',
  component: CommentComposer,
  parameters: storyContext('apps/web/app/components/personal-tasks/MyTaskComments.vue:56', 'حقل تعليق وزر نشر. التطبيق يملك النص والتحقق والطلب؛ ويعلّق قائمة الإشارات `@` و`/` على الفتحة `below` وأحداث الحقل كما في `pmo/tasks/CommentComposer.vue`.'),
  args: { modelValue: '', placeholder: 'اكتب تعليقًا', submitLabel: 'نشر التعليق', onSubmit: fn() },
  render: args => ({
    components: { CommentComposer },
    setup: () => ({ args, body: ref(args.modelValue) }),
    template: '<div class="max-w-xl"><CommentComposer v-bind="args" v-model="body" /></div>',
  }),
} satisfies Meta<typeof CommentComposer>
export default meta
type Story = StoryObj<typeof meta>

export const Plain: Story = { name: 'نص عادي' }
export const WithLabel: Story = { name: 'بعنوان وتلميح', args: { label: 'إضافة تعليق', help: 'اكتب @ لذكر شخص أو / للإشارة إلى مهمة' } }
export const Pending: Story = { name: 'أثناء النشر', args: { modelValue: 'تمت المراجعة', pending: true } }
export const TooLong: Story = { name: 'تعليق أطول من المسموح', args: { modelValue: 'نص', invalid: true, problem: 'التعليق أطول من الحد المسموح.' } }
export const ServerError: Story = { name: 'خطأ من الخادم', args: { modelValue: 'تمت المراجعة', error: 'تعذر نشر التعليق. حاول مرة أخرى.' } }
