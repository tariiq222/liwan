import type { Meta, StoryObj } from '@storybook/vue3-vite'
import InsuranceSettingsForm from '../../../app/components/hr/insurance/InsuranceSettingsForm.vue'
import { storyContext } from '../../support/context'
import { insuranceSettingsFixture } from './fixtures'

const meta = {
  title: 'HR/Insurance/InsuranceSettingsForm',
  component: InsuranceSettingsForm,
  parameters: storyContext('apps/web/app/pages/settings/apps/hr/index.vue:225', 'سياسة التأمين الطبي في إعدادات الموارد البشرية: ما يراه الموظف، ومدة التنبيه قبل انتهاء الخطة، واشتراط رقم هوية التابع.'),
  args: { settings: insuranceSettingsFixture, canEdit: true, reloadSettings: async () => insuranceSettingsFixture },
} satisfies Meta<typeof InsuranceSettingsForm>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const ReadOnly: Story = { args: { canEdit: false } }
