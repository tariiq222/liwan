import type { Meta, StoryObj } from '@storybook/vue3-vite'
import GosiRateTable from '../../../app/components/hr/payroll/GosiRateTable.vue'
import PageContainer from '@liwan/ui/app/components/shared/layout/PageContainer.vue'
import { storyContext } from '../../support/context'

// The GOSI contribution rates of the company on the payroll settings page: a shared row is read-only, a company row
// opens its edit form above the table and is deleted after an inline confirmation.
const rates = [
  { id: 1, branch: 'annuities', nationality_class: 'saudi_from_2024', date_from: '2024-07-03', employee_rate: 9.5, employer_rate: 11.5, wage_min: 400, wage_max: 45000, shared: true, revision: 1 },
  { id: 2, branch: 'saned', nationality_class: 'saudi_from_2024', date_from: '2024-07-03', employee_rate: 0.75, employer_rate: 0.75, wage_min: 400, wage_max: 45000, shared: true, revision: 1 },
  { id: 3, branch: 'hazards', nationality_class: 'non_saudi', date_from: '2026-01-01', employee_rate: 0, employer_rate: 2, wage_min: 0, wage_max: 45000, shared: false, revision: 2 },
]

const meta = {
  title: 'HR/Payroll/GosiRateTable',
  component: GosiRateTable,
  parameters: {
    layout: 'fullscreen',
    ...storyContext('apps/web/app/pages/settings/apps/hr/index.vue:126', 'قسم نسب التأمينات الاجتماعية في إعدادات الرواتب: جدول النسب بحسب الفرع والفئة وتاريخ السريان، والنسب المشتركة للقراءة فقط.'),
  },
  args: { rates, canEdit: true, reloadRates: async () => rates },
  render: args => ({
    components: { GosiRateTable, PageContainer },
    setup: () => ({ args }),
    template: '<main class="liwan-shell-main"><PageContainer width="list"><GosiRateTable v-bind="args" /></PageContainer></main>',
  }),
} satisfies Meta<typeof GosiRateTable>

export default meta
type Story = StoryObj<typeof meta>

export const Editable: Story = { name: 'قابلة للتعديل' }

export const ReadOnly: Story = { name: 'قراءة فقط', args: { canEdit: false } }

export const Empty: Story = { name: 'بلا نسب', args: { rates: [] } }
