import type { Meta, StoryObj } from '@storybook/vue3-vite'
import CompensationForm from '../../../app/components/hr/payroll/CompensationForm.vue'
import PageContainer from '@liwan/ui/app/components/shared/layout/PageContainer.vue'
import { storyContext } from '../../support/context'

// The compensation editor: wage and allowances, IBAN, GOSI facts. The bank on record stays as it is and
// the nationality is read-only; the page owns the navigation after a save.
const meta = {
  title: 'HR/Payroll/CompensationForm',
  component: CompensationForm,
  parameters: {
    layout: 'fullscreen',
    ...storyContext('apps/web/app/pages/hr/employees/[employeeId]/compensation.vue:24', 'نموذج تعديل التعويضات: ثلاثة `SharedFormSection panel` للأجر والبدلات والحساب البنكي والتأمينات، وتذييل واحد `SharedFormActions`.'),
  },
  args: {
    employeeId: 3,
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
    backTo: '/hr/employees/3',
  },
  render: args => ({
    components: { CompensationForm, PageContainer },
    setup: () => ({ args }),
    template: '<PageContainer width="form"><CompensationForm v-bind="args" /></PageContainer>',
  }),
} satisfies Meta<typeof CompensationForm>

export default meta
type Story = StoryObj<typeof meta>

export const Edit: Story = { name: 'تعديل' }

export const New: Story = { name: 'تسجيل أول مرة', args: { compensation: null } }
