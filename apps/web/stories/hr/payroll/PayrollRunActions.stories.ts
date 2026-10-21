import type { Meta, StoryObj } from '@storybook/vue3-vite'
import PayrollRunActions from '../../../app/components/hr/payroll/PayrollRunActions.vue'
import PageContainer from '@webvue/ui/app/components/shared/layout/PageContainer.vue'
import { storyContext } from '../../support/context'

// The transitions of one payroll run, offered exactly as the run's `allowed_actions` say (post and record payment come
// with the finance bridge). Approve, cancel and post ask for an inline confirmation, and every action stays pending
// until the server answers.
const run = {
  id: 5,
  month: '2026-10',
  state: 'computed',
  employee_count: 12,
  totals: { gross: 98400, deductions: 12000, gosi_employee: 5400, gosi_employer: 6900, net: 86400 },
  approved_at: null,
  warnings: [],
  allowed_actions: ['compute', 'approve', 'cancel', 'edit_inputs'],
  approved_by: null,
  finance: null,
}

const meta = {
  title: 'HR/Payroll/PayrollRunActions',
  component: PayrollRunActions,
  parameters: {
    layout: 'fullscreen',
    ...storyContext('apps/web/app/pages/hr/payroll/[runId]/index.vue:187', 'إجراءات المسير أسفل رأس الصفحة: احتساب، واعتماد وإلغاء وترحيل بتأكيد مضمّن، وتسجيل الصرف، وتبقى الأزرار معلّقة حتى يردّ الخادم.'),
  },
  args: { run, pending: null },
  render: args => ({
    components: { PayrollRunActions, PageContainer },
    setup: () => ({ args }),
    template: '<main class="webvue-shell-main"><PageContainer width="full"><PayrollRunActions v-bind="args" /></PageContainer></main>',
  }),
} satisfies Meta<typeof PayrollRunActions>

export default meta
type Story = StoryObj<typeof meta>

export const Computed: Story = { name: 'محسوب: كل الإجراءات' }

export const Draft: Story = { name: 'مسودة', args: { run: { ...run, state: 'draft', allowed_actions: ['compute', 'cancel', 'edit_inputs'] } } }

export const Approving: Story = { name: 'اعتماد قيد التنفيذ', args: { pending: 'approve' } }

export const Approved: Story = { name: 'معتمد: بلا إجراءات', args: { run: { ...run, state: 'approved', allowed_actions: [] } } }

export const ApprovedWithFinance: Story = { name: 'معتمد: ترحيل متاح', args: { run: { ...run, state: 'approved', allowed_actions: ['post'] } } }

export const Posting: Story = { name: 'ترحيل قيد التنفيذ', args: { pending: 'post', run: { ...run, state: 'approved', allowed_actions: ['post'] } } }

export const Posted: Story = { name: 'مرحّل: تسجيل الصرف', args: { run: { ...run, state: 'posted', allowed_actions: ['record_payment'] } } }
