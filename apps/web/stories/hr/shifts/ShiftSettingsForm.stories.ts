import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ShiftSettingsForm from '../../../app/components/hr/shifts/ShiftSettingsForm.vue'
import { storyContext } from '../../support/context'

const meta = {
  title: 'HR/Shifts/ShiftSettingsForm', component: ShiftSettingsForm,
  parameters: { ...storyContext('apps/web/app/pages/settings/apps/hr/index.vue:114', 'مرجع يوم جدول العمل للشركة أو المستخدم.') },
  args: { settings: { day_reference: 'company', company_timezone: 'Asia/Riyadh', effective_timezone: 'Asia/Riyadh', today: '2026-10-23', revision: 0 }, canEdit: true },
} satisfies Meta<typeof ShiftSettingsForm>
export default meta
type Story = StoryObj<typeof meta>
export const CompanyDefault: Story = {}
export const UserReference: Story = { args: { settings: { ...meta.args.settings, day_reference: 'user' } } }
export const ReadOnly: Story = { args: { canEdit: false } }
