import type { Meta, StoryObj } from '@storybook/vue3-vite'
import type { TenantExport } from '../../app/utils/tenantExport'
import TenantExportPanel from '../../app/components/settings/TenantExportPanel.vue'
import { storyContext } from '../support/context'

const base: TenantExport = {
  id: 1, state: 'done', requested_at: '2030-01-10T08:00:00Z', started_at: '2030-01-10T08:01:00Z', finished_at: '2030-01-10T08:20:00Z',
  expires_at: '2030-01-17T08:20:00Z', failure: null, steps_done: 5, steps_total: 5, size_bytes: 52_000_000,
  counts: { rows: { 'pmo.project': 120, 'hr.employee': 45 }, files: 310, file_bytes: 50_000_000, overflow_cells: 2 }, downloadable: true,
}
const pending = (id: number, state: TenantExport['state']): TenantExport => ({ ...base, id, state, finished_at: null, expires_at: null, counts: null, downloadable: false })
const meta = {
  title: 'Settings/TenantExportPanel', component: TenantExportPanel,
  parameters: { layout: 'padded', ...storyContext('apps/web/app/pages/settings/system/export.vue:33'), a11y: { test: 'error' } },
  args: { exports: [base], retentionDays: 7, timezone: 'Asia/Riyadh' },
} satisfies Meta<typeof TenantExportPanel>
export default meta
type Story = StoryObj<typeof meta>
export const Finished: Story = {}
export const Running: Story = { args: { exports: [{ ...pending(3, 'running'), steps_done: 2, steps_total: 5 }, base] } }
export const Waiting: Story = { args: { nextExportAt: '2030-01-11T08:20:00Z', cooldownHours: 24 } }
export const Mixed: Story = { args: { exports: [
  { ...base, id: 5, state: 'failed', counts: null, downloadable: false, failure: { code: 'insufficient_disk', message: 'Not enough disk space' } },
  { ...base, id: 4, state: 'expired', downloadable: false },
  base,
] } }
export const Empty: Story = { args: { exports: [] } }
export const RefusedRequest: Story = { args: { actionError: 'بدّل إلى جلسة تغطي الشركة الرئيسية وكل الفروع ثم أعد المحاولة.' } }
