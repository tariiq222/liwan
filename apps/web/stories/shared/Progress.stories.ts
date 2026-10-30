import type { Meta, StoryObj } from '@storybook/vue3-vite'
import Progress from '@liwan/ui/app/components/shared/data/Progress.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/Progress',
  component: Progress,
  parameters: { layout: 'padded', a11y: { test: 'error' }, ...storyContext('packages/ui/app/components/shared/data/MetricTile.vue:72', 'شريط التقدم الوحيد (غلاف `UProgress`): `size` sm=6px وmd=8px، `tone` primary/success/warning/danger/neutral، و`label` لاسم مسموع. الحركة 300ms وتتوقف مع تقليل الحركة.') },
  args: { value: 64, size: 'sm', tone: 'primary', label: 'نسبة الإنجاز' },
  render: args => ({ components: { Progress }, setup: () => ({ args }), template: '<div class="max-w-xs"><Progress v-bind="args" /></div>' }),
} satisfies Meta<typeof Progress>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { name: 'افتراضي' }
export const Tones: Story = {
  name: 'النبرات والحجمان',
  render: () => ({
    components: { Progress },
    template: `<div class="grid max-w-xs gap-3"><Progress :value="64" tone="primary" label="primary" /><Progress :value="40" tone="success" label="success" /><Progress :value="55" tone="warning" label="warning" /><Progress :value="100" tone="danger" label="danger" /><Progress :value="30" tone="neutral" label="neutral" /><Progress :value="64" size="md" label="md" /><Progress :value="100" label="complete" /></div>`,
  }),
}
