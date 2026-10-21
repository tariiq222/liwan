import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { useI18n } from 'vue-i18n'
import PayrollRunCreateForm from '../../../app/components/hr/payroll/PayrollRunCreateForm.vue'
import CreatePanel from '@webvue/ui/app/components/shared/layout/CreatePanel.vue'
import { storyContext } from '../../support/context'

// The payroll run create form inside the /hr/payroll/new SharedCreatePanel: it asks for the month only, posts it and
// reports the created run; the page owns the navigation.
const meta = {
  title: 'HR/Payroll/PayrollRunCreateForm',
  component: PayrollRunCreateForm,
  parameters: {
    layout: 'fullscreen',
    ...storyContext('apps/web/app/pages/hr/payroll/new.vue:23', 'نموذج إنشاء المسير داخل `SharedCreatePanel`: `SharedFormSection panel` بحقل الشهر، وتذييل واحد `SharedFormActions`.'),
  },
  args: { backTo: '/hr/payroll' },
  render: args => ({
    components: { PayrollRunCreateForm, CreatePanel },
    setup: () => ({ args, t: useI18n().t }),
    template: '<CreatePanel :title="t(\'hrPayroll.runs.new\')" back-to="/hr/payroll"><PayrollRunCreateForm v-bind="args" /></CreatePanel>',
  }),
} satisfies Meta<typeof PayrollRunCreateForm>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { name: 'نموذج المسير' }
