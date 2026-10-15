import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { fn } from 'storybook/test'
import FilterChip from '../../app/components/shared/data/FilterChip.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/FilterChip',
  component: FilterChip,
  parameters: storyContext('apps/web/app/pages/meetings/index.vue:295', 'شريحة فلتر نشط تحت شريط الفلاتر؛ الضغط عليها يزيل الفلتر.'),
  args: { label: 'بحث: عقد', disabled: false, onRemove: fn() },
  render: args => ({
    components: { FilterChip },
    setup: () => ({ args }),
    template: '<div class="flex flex-wrap items-center gap-2 text-xs text-muted"><FilterChip v-bind="args" /><FilterChip label="مؤكد" @remove="args.onRemove" /></div>',
  }),
} satisfies Meta<typeof FilterChip>
export default meta
type Story = StoryObj<typeof meta>

export const ActiveRow: Story = { name: 'صف الفلاتر النشطة' }
export const Disabled: Story = { name: 'معطّلة', args: { disabled: true } }
