import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { fn } from 'storybook/test'
import InlineConfirm from '../../app/components/shared/InlineConfirm.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/InlineConfirm',
  component: InlineConfirm,
  parameters: storyContext('apps/web/app/components/pmo/projects/ProjectMenu.vue:74', 'تأكيد داخل الصفحة للإجراء الهدّام: الإلغاء أولًا ثم الإجراء، ولا نافذة منبثقة.'),
  args: { title: 'أرشفة المشروع؟', description: 'تُخفى المهام والمعالم من القوائم ويمكن استعادتها لاحقًا.', confirmLabel: 'أرشفة', pending: false, disabled: false, color: 'error', onConfirm: fn(), onCancel: fn() },
  render: args => ({
    components: { InlineConfirm },
    setup: () => ({ args }),
    template: '<div class="max-w-xl"><InlineConfirm v-bind="args" /></div>',
  }),
} satisfies Meta<typeof InlineConfirm>
export default meta
type Story = StoryObj<typeof meta>

export const Archive: Story = { name: 'أرشفة' }
export const Pending: Story = { name: 'قيد التنفيذ', args: { pending: true } }
export const Blocked: Story = { name: 'غير متاح', args: { title: 'لا يمكن حذف المعلم', description: 'انقل مهامه أولًا.', confirmLabel: 'حذف', disabled: true } }
