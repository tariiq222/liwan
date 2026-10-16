import type { Meta, StoryObj } from '@storybook/vue3-vite'
import LoadingSkeleton from '@webvue/ui/app/components/shared/feedback/LoadingSkeleton.vue'
import PageContainer from '@webvue/ui/app/components/shared/layout/PageContainer.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/LoadingSkeleton',
  component: LoadingSkeleton,
  parameters: { layout: 'fullscreen', a11y: { test: 'error' }, ...storyContext('packages/ui/app/components/shared/feedback/PageState.vue:18', 'حالة التحميل الوحيدة: صفوف للقوائم، وسجل بعمود خصائص، وبطاقات للوحات.') },
  args: { variant: 'rows', count: 3 },
  render: args => ({
    components: { LoadingSkeleton, PageContainer },
    setup: () => ({ args }),
    template: '<main class="webvue-shell-main"><PageContainer width="list"><LoadingSkeleton v-bind="args" /></PageContainer></main>',
  }),
} satisfies Meta<typeof LoadingSkeleton>
export default meta
type Story = StoryObj<typeof meta>

export const Rows: Story = { name: 'صفوف قائمة' }
export const Record: Story = { name: 'سجل', args: { variant: 'record' } }
export const Cards: Story = { name: 'بطاقات لوحة', args: { variant: 'cards', count: 4 } }
