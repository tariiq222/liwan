import type { Meta, StoryObj } from '@storybook/vue3-vite'
import WarningSettingsForm from '../../../app/components/hr/warnings/WarningSettingsForm.vue'
import { storyContext } from '../../support/context'
import { warningSettingsFixture } from './fixtures'

const meta = {
  title: 'HR/Warnings/WarningSettingsForm',
  component: WarningSettingsForm,
  parameters: storyContext('apps/web/app/pages/settings/apps/hr/index.vue:202', 'سياسات الإنذارات الإدارية للشركة: من يصدر، ورد الموظف، ومدة التصعيد.'),
  args: { settings: warningSettingsFixture, canEdit: true, reloadSettings: async () => ({ ...warningSettingsFixture, revision: 2 }) },
} satisfies Meta<typeof WarningSettingsForm>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const ManagerAndHr: Story = { args: { settings: { ...warningSettingsFixture, warnings_issued_by: 'manager_and_hr', warnings_employee_acknowledgement: 'optional' } } }
export const ReadOnly: Story = { args: { canEdit: false } }
