import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { ref } from 'vue'
import DateField from '../../app/components/shared/DateField.vue'
import FilterField from '../../app/components/shared/FilterField.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/FilterField',
  component: FilterField,
  parameters: storyContext('apps/web/app/pages/meetings/index.vue:335', 'تسمية حقل داخل نافذة الفلاتر. مع `for` تسمّي عنصرًا واحدًا، وبدونه تصبح مجموعة.'),
  args: { label: 'المنظّم', for: 'story-organizer' },
  render: args => ({
    components: { DateField, FilterField },
    setup: () => ({ args, q: ref(''), from: ref<string | null>(null) }),
    template: '<div class="flex flex-wrap gap-4 rounded-lg ring ring-default bg-default p-4"><FilterField v-bind="args"><UInput id="story-organizer" v-model="q" icon="i-lucide-search" placeholder="بحث عن منظّم" class="w-full" /></FilterField><FilterField label="من تاريخ" for="story-from"><DateField id="story-from" v-model="from" class="w-full" /></FilterField></div>',
  }),
} satisfies Meta<typeof FilterField>
export default meta
type Story = StoryObj<typeof meta>

export const InFilterPanel: Story = { name: 'داخل نافذة الفلاتر' }
