import type { Meta, StoryObj } from '@storybook/vue3-vite'
import PayrollRunTotals from '../../../app/components/hr/payroll/PayrollRunTotals.vue'
import PageContainer from '@webvue/ui/app/components/shared/layout/PageContainer.vue'
import { storyContext } from '../../support/context'

// The four figures above a run's register, drawn by SharedKpiStrip: net pay, gross, deductions and the employer's
// GOSI share. They are hidden on paper (the register prints its own totals row).
const meta = {
  title: 'HR/Payroll/PayrollRunTotals',
  component: PayrollRunTotals,
  parameters: {
    layout: 'fullscreen',
    ...storyContext('apps/web/app/pages/hr/payroll/[runId]/index.vue:235', 'شريط أرقام المسير أعلى كشف الرواتب: صافي الرواتب، والإجمالي، والخصومات، وحصة صاحب العمل في التأمينات.'),
  },
  args: {
    totals: { gross: 98400, deductions: 12000, gosi_employee: 5400, gosi_employer: 6900, net: 86400 },
    employeeCount: 12,
  },
  render: args => ({
    components: { PayrollRunTotals, PageContainer },
    setup: () => ({ args }),
    template: '<main class="webvue-shell-main"><PageContainer width="full"><PayrollRunTotals v-bind="args" /></PageContainer></main>',
  }),
} satisfies Meta<typeof PayrollRunTotals>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { name: 'أرقام المسير' }

export const Loading: Story = { name: 'أثناء التحميل', args: { loading: true } }
