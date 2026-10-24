import type { Meta, StoryObj } from '@storybook/vue3-vite'
import HeaderTags from '@webvue/ui/app/components/shared/layout/HeaderTags.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/HeaderTags',
  component: HeaderTags,
  parameters: { layout: 'padded', a11y: { test: 'error' }, ...storyContext('packages/ui/app/components/shared/layout/PageHeader.vue:91', 'وسوم الترويسة: حبّات كاملة الاستدارة بعد العنوان؛ الحالة بلون `tone` والحقيقة العادية بلون نوعها `kind`، ومن لها `to` رابط. تستعملها `SharedPageHeader` وبطاقة مساحة المشروع.') },
  args: {
    tags: [
      { label: 'قيد التنفيذ', tone: 'success' },
      { label: 'التخطيط', tone: 'info' },
      { label: 'سارة القحطاني', kind: 'person', icon: 'i-lucide-user' },
      { label: '١ يناير – ٣١ ديسمبر', kind: 'schedule', icon: 'i-lucide-calendar-range' },
    ],
  },
  render: args => ({
    components: { HeaderTags },
    setup: () => ({ args }),
    template: '<div class="flex flex-wrap items-center gap-2"><HeaderTags v-bind="args" /></div>',
  }),
} satisfies Meta<typeof HeaderTags>
export default meta
type Story = StoryObj<typeof meta>

export const StateAndFacts: Story = { name: 'حالة وحقائق' }
