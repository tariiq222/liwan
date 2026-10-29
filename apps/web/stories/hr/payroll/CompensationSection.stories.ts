import type { Meta, StoryObj } from '@storybook/vue3-vite'
import CompensationSection from '../../../app/components/hr/payroll/CompensationSection.vue'
import RecordPage from '@webvue/ui/app/components/shared/layout/RecordPage.vue'
import { storyContext } from '../../support/context'

// The payroll-only compensation block of the employee record: wage, allowances, bank account and GOSI facts.
// The page owns the query and shows it only to viewers with the payroll read capability.
const meta = {
  title: 'HR/Payroll/CompensationSection',
  component: CompensationSection,
  parameters: {
    layout: 'fullscreen',
    ...storyContext('apps/web/app/pages/hr/employees/[employeeId].vue:77', 'قسم التعويضات في سجل الموظف: الأجر الأساسي والبدلات والأجر الثابت والآيبان والبنك ورقم التأمينات والجنسية، وزر التعديل لمن يملك صلاحية الإدارة فقط.'),
  },
  args: {
    compensation: {
      employee: { id: 3, name: 'ليلى الحربي' },
      basic_wage: 8000,
      housing_allowance: 2000,
      transport_allowance: 500,
      other_allowance: 0,
      fixed_wage: 10500,
      iban: 'SA0380000000608010167519',
      bank: { id: 4, name: 'مصرف الراجحي' },
      gosi_number: '123456789',
      gosi_registration_date: '2024-01-01',
      nationality: { id: 186, name: 'السعودية', code: 'SA' },
      relationship_type: 'employee',
      currency: 'SAR',
    },
    canManage: true,
    editTo: '/hr/employees/3/compensation',
  },
  render: args => ({
    components: { CompensationSection, RecordPage },
    setup: () => ({ args }),
    template: '<RecordPage title="ليلى الحربي" back-to="/hr"><CompensationSection v-bind="args" /></RecordPage>',
  }),
} satisfies Meta<typeof CompensationSection>

export default meta
type Story = StoryObj<typeof meta>

export const Recorded: Story = { name: 'مسجّلة' }

export const Contractor: Story = {
  name: 'متعاقد مستقل مع تنبيه',
  args: { compensation: { ...meta.args.compensation, relationship_type: 'independent_contractor' } },
}

export const ReadOnly: Story = { name: 'قراءة فقط', args: { canManage: false } }

export const Empty: Story = { name: 'غير مسجّلة', args: { compensation: null } }
