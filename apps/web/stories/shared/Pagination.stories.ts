import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { ref } from 'vue'
import Pagination from '@webvue/ui/app/components/shared/data/Pagination.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/Pagination',
  component: Pagination,
  parameters: storyContext('packages/ui/app/components/shared/data/ListFooter.vue:12', 'في تذييل بطاقة القائمة. تختفي حين تتسع صفحة واحدة لكل السجلات.'),
  args: { page: 1, pages: 8, disabled: false },
  render: args => ({
    components: { Pagination },
    setup: () => ({ args, page: ref(args.page) }),
    template: '<div class="max-w-3xl"><Pagination v-bind="args" :page="page" @update:page="page = $event" /></div>',
  }),
} satisfies Meta<typeof Pagination>
export default meta
type Story = StoryObj<typeof meta>

export const UnderTable: Story = { name: 'تحت جدول' }
export const MiddlePage: Story = { name: 'صفحة وسطى', args: { page: 5 } }
export const Fetching: Story = { name: 'أثناء التحميل', args: { page: 2, disabled: true } }
