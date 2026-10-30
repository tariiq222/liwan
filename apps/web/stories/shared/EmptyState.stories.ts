import type { Meta, StoryObj } from '@storybook/vue3-vite'
import EmptyState from '@liwan/ui/app/components/shared/feedback/EmptyState.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/EmptyState',
  component: EmptyState,
  parameters: { a11y: { test: 'error' } },
  args: { title: '' },
} satisfies Meta<typeof EmptyState>
export default meta
type Story = StoryObj<typeof meta>

export const InTaskTable: Story = {
  name: 'داخل جدول المهام',
  parameters: storyContext('packages/ui/app/components/shared/feedback/PageState.vue:22'),
  render: () => ({
    components: { EmptyState },
    template: `<div class="space-y-2"><div class="rounded-card ring ring-default bg-default overflow-hidden"><div class="hidden overflow-x-auto md:block"><EmptyState :title="$t('tasks.empty.title')"><template #action><UButton size="sm">{{ $t('tasks.empty.action') }}</UButton></template></EmptyState></div></div></div>`,
  }),
}

export const InTaskListMobile: Story = {
  name: 'داخل قائمة المهام على الجوال',
  parameters: storyContext('packages/ui/app/components/shared/feedback/PageState.vue:22', 'يظهر تحت 768px (md:hidden)، فالغلاف بعرض شاشة جوال 375px.'),
  render: () => ({
    components: { EmptyState },
    template: `<div class="rounded-card ring ring-default bg-default overflow-hidden" style="width: 375px"><div class="divide-y divide-default"><div class="p-6 text-center"><EmptyState :title="$t('tasks.empty.closedTitle')" /></div></div></div>`,
  }),
}

export const Bordered: Story = {
  name: 'بطاقة كاملة لصفحة فارغة',
  parameters: storyContext('unused', '`bordered`: وصفة البطاقة (18px وحد رفيع وخلفية بيضاء) حين يكون كل جسم الصفحة فارغًا، بدل البطاقة المرسومة يدويًا.'),
  render: () => ({
    components: { EmptyState },
    template: `<div class="max-w-2xl bg-muted p-4"><EmptyState bordered :title="$t('tasks.empty.title')"><template #action><UButton size="sm">{{ $t('tasks.empty.action') }}</UButton></template></EmptyState></div>`,
  }),
}

export const Compact: Story = {
  name: 'حالة فارغة مدمجة داخل قسم',
  args: { compact: true },
  render: args => ({
    components: { EmptyState },
    setup: () => ({ args }),
    template: `<EmptyState v-bind="args" :title="$t('documents.noFiles')" />`,
  }),
  parameters: storyContext('apps/web/app/components/documents/DocumentFiles.vue:35'),
}
