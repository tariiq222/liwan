import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ListCard from '@webvue/ui/app/components/shared/layout/ListCard.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/ListCard',
  component: ListCard,
  parameters: storyContext('apps/web/app/pages/tasks.vue:94', 'بطاقة القائمة: صف فلاتر مدمج في الترويسة وتحته سطح القائمة (جدول بلا بطاقة أو لوحة). التبديل بين العرضين يغيّر ما تحت الصف فقط.'),
  render: () => ({
    components: { ListCard },
    template: '<div class="max-w-3xl"><ListCard><template #filters><UInput icon="i-lucide-search" placeholder="بحث" class="w-full" /></template><p class="p-4 text-sm text-muted">سطح القائمة</p></ListCard></div>',
  }),
} satisfies Meta<typeof ListCard>
export default meta
type Story = StoryObj<typeof meta>

export const Fill: Story = {
  name: 'بحجم الشاشة (لوحة أو خط زمني)',
  parameters: { layout: 'fullscreen' },
  render: () => ({
    components: { ListCard },
    template: '<main class="webvue-shell-main"><ListCard fill><template #filters><UInput icon="i-lucide-search" placeholder="بحث" class="w-full" /></template><div class="webvue-thin-scroll min-h-0 flex-1 overflow-auto p-4"><p v-for="n in 40" :key="n" class="text-sm text-muted">سطر {{ n }}: يتمرر داخل البطاقة</p></div></ListCard></main>',
  }),
}
export const WithFooter: Story = {
  name: 'مع تذييل',
  render: () => ({
    components: { ListCard },
    template: '<div class="max-w-3xl"><ListCard><template #filters><UInput icon="i-lucide-search" placeholder="بحث" class="w-full" /></template><p class="p-4 text-sm text-muted">سطح القائمة</p><template #footer><span class="tabular-nums">عرض 20 من 143 نتيجة</span></template></ListCard></div>',
  }),
}
export const WithFilters: Story = { name: 'مع صف فلاتر' }
