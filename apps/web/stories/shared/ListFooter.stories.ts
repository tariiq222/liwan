import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { ref } from 'vue'
import ListFooter from '@webvue/ui/app/components/shared/data/ListFooter.vue'
import ListCard from '@webvue/ui/app/components/shared/layout/ListCard.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/ListFooter',
  component: ListFooter,
  parameters: { layout: 'padded', ...storyContext('apps/web/app/pages/projects/index.vue:343', 'تذييل بطاقة القائمة: العدد في البداية والترقيم في النهاية، داخل خانة `footer` لبطاقة القائمة. يختفي الترقيم حين تتسع صفحة واحدة.') },
  args: { countLabel: 'عرض 20 من 143 نتيجة', page: 2, pages: 8, disabled: false },
  render: args => ({
    components: { ListFooter, ListCard },
    setup: () => ({ args, page: ref(args.page) }),
    template: '<div class="max-w-3xl"><ListCard><p class="p-4 text-sm text-muted">سطح القائمة</p><template #footer><ListFooter v-bind="args" :page="page" @update:page="page = $event" /></template></ListCard></div>',
  }),
} satisfies Meta<typeof ListFooter>
export default meta
type Story = StoryObj<typeof meta>

export const WithPager: Story = { name: 'عدد وترقيم' }
export const SinglePage: Story = { name: 'صفحة واحدة (العدد فقط)', args: { countLabel: 'عرض 7 من 7 نتائج', page: 1, pages: 1 } }
export const Fetching: Story = { name: 'أثناء التحميل', args: { disabled: true } }
