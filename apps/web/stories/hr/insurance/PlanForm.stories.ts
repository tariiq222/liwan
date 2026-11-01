import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { useI18n } from 'vue-i18n'
import PlanForm from '../../../app/components/hr/insurance/PlanForm.vue'
import CreatePanel from '@liwan/ui/app/components/shared/layout/CreatePanel.vue'
import { storyContext } from '../../support/context'
import { planFixture, providersFixture } from './fixtures'

// The plan form: it creates inside the /hr/insurance/plans/new SharedCreatePanel, or edits the plan on its record page.
const meta = {
  title: 'HR/Insurance/PlanForm',
  component: PlanForm,
  parameters: {
    layout: 'fullscreen',
    ...storyContext('apps/web/app/pages/hr/insurance/plans/new.vue:25', 'نموذج خطة التأمين: المزوّد واسم الخطة وفئتها وفترة صلاحيتها ورقم الوثيقة والقسط السنوي، وتذييل واحد `SharedFormActions`.'),
  },
  args: { providers: providersFixture.filter(provider => provider.active), backTo: '/hr/insurance' },
  render: args => ({
    components: { PlanForm, CreatePanel },
    setup: () => ({ args, t: useI18n().t }),
    template: '<CreatePanel :title="t(\'hrInsurance.newPlan\')" back-to="/hr/insurance"><PlanForm v-bind="args" /></CreatePanel>',
  }),
} satisfies Meta<typeof PlanForm>

export default meta
type Story = StoryObj<typeof meta>

export const Create: Story = { name: 'خطة جديدة' }
export const Edit: Story = { name: 'تعديل خطة', args: { plan: planFixture() } }
export const NoProviders: Story = { name: 'بلا مزوّدين', args: { providers: [] } }
