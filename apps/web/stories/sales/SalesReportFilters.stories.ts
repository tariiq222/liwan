import type { Meta, StoryObj } from '@storybook/vue3-vite'
import SalesReportFilters from '../../app/components/sales/SalesReportFilters.vue'
import { storyContext } from '../support/context'
import { defaultReportState, pickedReportState } from './salesReportFixtures'

const meta = {
  title: 'Sales/SalesReportFilters',
  component: SalesReportFilters,
  parameters: { layout: 'padded', ...storyContext('apps/web/app/pages/sales/reports.vue:52', 'مرشحات تقرير المبيعات: المرحلة والمدى والمصدر، ومن اختير من صف المجموعات.') },
  args: { state: defaultReportState },
} satisfies Meta<typeof SalesReportFilters>
export default meta
type Story = StoryObj<typeof meta>

export const Defaults: Story = { name: 'الافتراضي' }
export const Narrowed: Story = { name: 'مضيّق بمدى ومصدر ومندوب', args: { state: pickedReportState } }
export const Disabled: Story = { name: 'قبل الترطيب', args: { disabled: true } }
