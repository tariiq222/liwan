import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { ref } from 'vue'
import FilterPopover from '@liwan/ui/app/components/shared/data/FilterPopover.vue'
import FilterBar from '@liwan/ui/app/components/shared/data/FilterBar.vue'
import FilterField from '@liwan/ui/app/components/shared/data/FilterField.vue'
import FilterChip from '@liwan/ui/app/components/shared/data/FilterChip.vue'
import { storyContext } from '../support/context'

const types = [
  { value: 'verbal', label: 'تنبيه شفهي' },
  { value: 'written', label: 'إنذار كتابي' },
  { value: 'final', label: 'إنذار نهائي' },
]

const meta = {
  title: 'Shared/FilterPopover',
  component: FilterPopover,
  parameters: storyContext('apps/web/app/pages/hr/warnings.vue:105', 'زر «فلاتر» واحد بعدّاد النشط منها يفتح نافذة بحقول الفلاتر؛ يوضع في شريط الأدوات المضمّن مع البحث والحالة.'),
  args: { count: 1, disabled: false },
  render: args => ({
    components: { FilterPopover, FilterBar, FilterField, FilterChip },
    setup: () => ({ args, type: ref<string | undefined>('written'), types }),
    template: `
      <div class="w-full max-w-3xl">
        <FilterBar inline :active-count="type ? 1 : 0" @clear="type = undefined">
          <template #search><UInput icon="i-lucide-search" placeholder="ابحث عن موظف بالاسم" /></template>
          <FilterPopover :count="type ? 1 : 0" :disabled="args.disabled">
            <FilterField label="النوع" for="story-type"><USelect id="story-type" v-model="type" class="w-full" :items="types" placeholder="كل الأنواع" /></FilterField>
          </FilterPopover>
          <template #active><FilterChip v-if="type" :label="types.find(item => item.value === type)?.label ?? ''" @remove="type = undefined" /></template>
        </FilterBar>
      </div>`,
  }),
} satisfies Meta<typeof FilterPopover>
export default meta
type Story = StoryObj<typeof meta>

export const WithActiveFilter: Story = { name: 'بفلتر نشط' }
export const Disabled: Story = { name: 'معطّل', args: { disabled: true } }
