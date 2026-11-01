import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { useI18n } from 'vue-i18n'
import EnrollmentForm from '../../../app/components/hr/insurance/EnrollmentForm.vue'
import CreatePanel from '@liwan/ui/app/components/shared/layout/CreatePanel.vue'
import { storyContext } from '../../support/context'
import { planFixture } from './fixtures'

// The enrollment create form inside the /hr/insurance/enrollments/new SharedCreatePanel.
const meta = {
  title: 'HR/Insurance/EnrollmentForm',
  component: EnrollmentForm,
  parameters: {
    layout: 'fullscreen',
    ...storyContext('apps/web/app/pages/hr/insurance/enrollments/new.vue:27', 'نموذج تسجيل موظف في خطة تأمين داخل `SharedCreatePanel`: الموظف والخطة وتواريخ التغطية ورقم العضوية والحصص الشهرية، وتذييل واحد `SharedFormActions`.'),
  },
  args: {
    plans: [planFixture(), planFixture({ id: 4, name: 'الباقة الفضية 2026', tier: 'فضية' })],
    backTo: '/hr/insurance',
  },
  render: args => ({
    components: { EnrollmentForm, CreatePanel },
    setup: () => ({ args, t: useI18n().t }),
    template: '<CreatePanel :title="t(\'hrInsurance.newEnrollment\')" back-to="/hr/insurance"><EnrollmentForm v-bind="args" /></CreatePanel>',
  }),
} satisfies Meta<typeof EnrollmentForm>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { name: 'نموذج التسجيل' }
export const NoPlans: Story = { name: 'بلا خطة سارية', args: { plans: [] } }
