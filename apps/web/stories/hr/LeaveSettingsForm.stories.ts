import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse, delay } from 'msw'
import LeaveSettingsForm from '../../app/components/hr/LeaveSettingsForm.vue'
import { storyContext } from '../support/context'
import { me } from '../fixtures/pmo'
const settings = { cancellation_policy: 'manager_approval' as const, revision: 0 }
const configOnly = http.get('/api/v1/me', () => HttpResponse.json({ ...me, capabilities: ['hr.leave.config'] }))
const meta = {
  title: 'HR/LeaveSettingsForm', component: LeaveSettingsForm,
  parameters: { ...storyContext('apps/web/app/pages/settings/apps/hr/index.vue:159', 'سياسة إلغاء الإجازة المعتمدة للشركة؛ صلاحية إعداد مستقلة عن الرواتب والموظفين.'), msw: { handlers: { api: [configOnly, http.patch('/api/v1/hr/leave/settings', async ({ request }) => HttpResponse.json({ ...await request.json() as object, revision: 1 }))] } } },
  args: { settings, canEdit: true, reloadSettings: async () => ({ cancellation_policy: 'manager_only', revision: 2 }) },
} satisfies Meta<typeof LeaveSettingsForm>
export default meta
type Story = StoryObj<typeof meta>
export const ManagerApprovalDefault: Story = {}
export const DirectEmployee: Story = { args: { settings: { cancellation_policy: 'direct_employee', revision: 1 } } }
export const ManagerOnly: Story = { args: { settings: { cancellation_policy: 'manager_only', revision: 1 } } }
export const ReadOnly: Story = { args: { canEdit: false } }
export const Saving: Story = { parameters: { msw: { handlers: { api: [configOnly, http.patch('/api/v1/hr/leave/settings', async () => { await delay(10_000); return HttpResponse.json({ cancellation_policy: 'direct_employee', revision: 1 }) })] } } } }
export const SaveError: Story = { parameters: { msw: { handlers: { api: [configOnly, http.patch('/api/v1/hr/leave/settings', () => HttpResponse.json({ code: 'unavailable', message: 'تعذر حفظ السياسة' }, { status: 503 }))] } } } }
export const Conflict: Story = { parameters: { msw: { handlers: { api: [configOnly, http.patch('/api/v1/hr/leave/settings', () => HttpResponse.json({ code: 'conflict', message: 'تغيّرت السياسة' }, { status: 409 }))] } } } }
