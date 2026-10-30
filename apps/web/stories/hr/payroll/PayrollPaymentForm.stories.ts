import type { Meta, StoryObj } from '@storybook/vue3-vite'
import PayrollPaymentForm from '../../../app/components/hr/payroll/PayrollPaymentForm.vue'
import PageContainer from '@liwan/ui/app/components/shared/layout/PageContainer.vue'
import { ApiError } from '../../../app/composables/useApi'
import { storyContext } from '../../support/context'

// The inline form that records the salary payment of a posted run: the bank or cash journal and the payment date, with
// the confirmation as its own button. A refusal of the server shows under the field it names.
const meta = {
  title: 'HR/Payroll/PayrollPaymentForm',
  component: PayrollPaymentForm,
  parameters: {
    layout: 'fullscreen',
    ...storyContext('apps/web/app/pages/hr/payroll/[runId]/index.vue:233', 'نموذج تسجيل صرف الرواتب داخل صفحة المسير المرحّل: دفتر البنك أو الصندوق وتاريخ الصرف بتأكيد مضمّن.'),
  },
  args: {
    journals: [{ id: 5, name: 'بنك الراجحي' }, { id: 6, name: 'الصندوق' }],
    pending: false,
    error: null,
    defaultDate: '2026-11-01',
  },
  render: args => ({
    components: { PayrollPaymentForm, PageContainer },
    setup: () => ({ args }),
    template: '<main class="liwan-shell-main"><PageContainer width="full"><PayrollPaymentForm v-bind="args" /></PageContainer></main>',
  }),
} satisfies Meta<typeof PayrollPaymentForm>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { name: 'افتراضي' }

export const Pending: Story = { name: 'قيد التنفيذ', args: { pending: true } }

export const PeriodLocked: Story = {
  name: 'الفترة مقفلة',
  args: { error: new ApiError(422, 'period_locked', 'The period is locked', 'date') },
}

export const NoJournals: Story = { name: 'بلا صلاحية الدفاتر', args: { journals: [] } }
