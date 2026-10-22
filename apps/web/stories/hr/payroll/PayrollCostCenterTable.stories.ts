import type { Meta, StoryObj } from '@storybook/vue3-vite'
import PayrollCostCenterTable from '../../../app/components/hr/payroll/PayrollCostCenterTable.vue'
import PageContainer from '@webvue/ui/app/components/shared/layout/PageContainer.vue'
import { storyContext } from '../../support/context'

// The cost center of each department in the payroll settings. A choice is saved at once; the row being saved waits.
const centers = [
  { department: { id: 1, name: 'المالية' }, analytic_account: { id: 5, name: 'فرع الرياض' } },
  { department: { id: 2, name: 'الموارد البشرية' }, analytic_account: null },
]

const meta = {
  title: 'HR/Payroll/PayrollCostCenterTable',
  component: PayrollCostCenterTable,
  parameters: {
    layout: 'fullscreen',
    ...storyContext('apps/web/app/pages/settings/apps/hr/index.vue:101', 'جدول مراكز تكلفة الأقسام في إعدادات الرواتب: يُحمَّل راتب كل قسم على مركز التكلفة المختار له.'),
  },
  args: {
    centers,
    analyticAccounts: [{ id: 5, code: 'BR-RUH', name: 'فرع الرياض' }, { id: 6, code: 'BR-JED', name: 'فرع جدة' }],
    truncated: false,
    canEdit: true,
    saving: [],
  },
  render: args => ({
    components: { PayrollCostCenterTable, PageContainer },
    setup: () => ({ args }),
    template: '<main class="webvue-shell-main"><PageContainer width="list"><PayrollCostCenterTable v-bind="args" /></PageContainer></main>',
  }),
} satisfies Meta<typeof PayrollCostCenterTable>

export default meta
type Story = StoryObj<typeof meta>

export const Editable: Story = { name: 'قابل للتعديل' }

export const Saving: Story = { name: 'حفظ صف قيد التنفيذ', args: { saving: [2] } }

export const ReadOnly: Story = { name: 'قراءة فقط', args: { canEdit: false } }

export const Truncated: Story = { name: 'قائمة مختصرة', args: { truncated: true } }
