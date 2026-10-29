import type { Meta, StoryObj } from '@storybook/vue3-vite'
import EosSettlementSection from '../../../app/components/hr/payroll/EosSettlementSection.vue'
import RecordPage from '@webvue/ui/app/components/shared/layout/RecordPage.vue'
import { storyContext } from '../../support/context'

// The end-of-service settlement on the offboarding record: the server's estimate before anything is saved, a draft that
// is saved with its case and open deductions, and a confirmed settlement that is read-only. Confirming asks inline and
// stays pending until the server answers.
const employee = { id: 2, name: 'خالد الشمري' }
const estimate = {
  employee,
  start_date: '2023-12-01',
  end_date: '2026-11-30',
  service_years: 2.99,
  eos_wage: 10500,
  case: 'resignation',
  award: 5232.5,
  leave_days: 12.5,
  leave_amount: 4375,
  currency: 'SAR',
} as const
const draft = {
  id: 7,
  employee,
  departure_date: null,
  departure_mismatch: false,
  case: 'resignation',
  service_years: 2.99,
  eos_wage: 10500,
  award: 5232.5,
  leave_days: 12.5,
  leave_amount: 4375,
  open_deductions: 300,
  total: 9307.5,
  state: 'draft',
  currency: 'SAR',
} as const

const meta = {
  title: 'HR/Payroll/EosSettlementSection',
  component: EosSettlementSection,
  parameters: {
    layout: 'fullscreen',
    ...storyContext('apps/web/app/pages/hr/offboarding/[employeeId].vue:122', 'قسم تسوية نهاية الخدمة في سجل مغادرة الموظف: تقدير المكافأة وبدل الإجازة، وحفظ المسودة بحالتها وخصوماتها، واعتماد التسوية بتأكيد مضمّن يبقى معلّقًا حتى يردّ الخادم.'),
  },
  args: {
    settlement: null,
    estimate,
    canManage: true,
    canApprove: true,
    saving: false,
    confirming: false,
    error: '',
    case: 'resignation',
  },
  render: args => ({
    components: { EosSettlementSection, RecordPage },
    setup: () => ({ args }),
    template: '<RecordPage title="خالد الشمري" back-to="/hr/offboarding"><EosSettlementSection v-bind="args" /></RecordPage>',
  }),
} satisfies Meta<typeof EosSettlementSection>

export default meta
type Story = StoryObj<typeof meta>

export const Estimate: Story = { name: 'تقدير قبل الحفظ' }

export const Draft: Story = { name: 'مسودة محفوظة', args: { settlement: draft, estimate: null } }

export const Confirmed: Story = { name: 'معتمدة', args: { settlement: { ...draft, state: 'confirmed', departure_date: '2026-11-30' }, estimate: null } }

export const DepartureChanged: Story = { name: 'تاريخ المغادرة تغيّر بعد الاعتماد', args: { settlement: { ...draft, state: 'confirmed', departure_date: '2026-11-30', departure_mismatch: true }, estimate: null } }

export const Confirming: Story = { name: 'اعتماد قيد التنفيذ', args: { settlement: draft, estimate: null, confirming: true } }

export const CaseMissing: Story = { name: 'سبب بلا حالة', args: { estimate: null, case: null, error: 'سبب المغادرة غير مربوط بحالة مكافأة. اختر الحالة هنا أو اربطها من إعدادات الرواتب.' } }

export const ReadOnly: Story = { name: 'قراءة فقط', args: { settlement: draft, estimate: null, canManage: false, canApprove: false } }
