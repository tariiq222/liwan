import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { fn } from 'storybook/test'
import { ref } from 'vue'
import CommentComposer from '../../app/components/shared/CommentComposer.vue'
import CommentThread from '../../app/components/shared/CommentThread.vue'
import { storyContext } from '../support/context'

const comments = [
  { id: 1, authorName: 'نورة الحربي', createdAt: '2026-10-10T08:30:00Z', body: 'راجعت المسودة، وأرجو تعديل البند الثالث.' },
  { id: 2, authorName: null, createdAt: '2026-10-11T12:00:00Z', body: 'تم التعديل.\nبانتظار الاعتماد.' },
]

// A plain-text thread; the compose form is the `composer` slot.
const meta = {
  title: 'Shared/CommentThread',
  component: CommentThread,
  parameters: storyContext('apps/web/app/components/personal-tasks/MyTaskComments.vue:47', 'قائمة تعليقات نصية مرتبة من الأقدم، مع فتحة `composer` لنموذج الكتابة. سجل المهمة الغني (HTML وتغييرات الحقول) يبقى في `pmo/tasks/Timeline.vue`.'),
  args: { comments, emptyText: 'لا تعليقات بعد', unknownAuthor: 'مستخدم غير معروف', onRetry: fn() },
  render: args => ({
    components: { CommentThread, CommentComposer },
    setup: () => ({ args, body: ref('') }),
    template: `<div class="max-w-xl"><CommentThread v-bind="args">
      <template #composer><CommentComposer v-model="body" placeholder="اكتب تعليقًا" submit-label="نشر التعليق" /></template>
    </CommentThread></div>`,
  }),
} satisfies Meta<typeof CommentThread>
export default meta
type Story = StoryObj<typeof meta>

export const WithComposer: Story = { name: 'مع نموذج الكتابة' }
export const Empty: Story = { name: 'بلا تعليقات', args: { comments: [] } }
export const Loading: Story = { name: 'قيد التحميل', args: { comments: [], loading: true } }
