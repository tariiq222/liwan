import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { useI18n } from 'vue-i18n'
import PropertyRow from '@webvue/ui/app/components/shared/layout/PropertyRow.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/PropertyRow',
  component: PropertyRow,
  parameters: { layout: 'padded', a11y: { test: 'error' }, ...storyContext('unused', 'خاصية واحدة؛ القيمة الفارغة تُعرض «—» وتُقرأ «لا قيمة».') },
} satisfies Meta<typeof PropertyRow>
export default meta
type Story = StoryObj

const row = (value: string | null) => ({
  components: { PropertyRow },
  setup: () => ({ t: useI18n().t, value }),
  template: `<dl class="max-w-xs"><PropertyRow :label="t('projects.columns.manager')" :value="value" /></dl>`,
})

export const WithValue: Story = { name: 'بقيمة', render: () => row('سارة القحطاني') }
export const Empty: Story = { name: 'فارغة', render: () => row(null) }
