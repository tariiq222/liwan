import type { Meta, StoryObj } from '@storybook/vue3-vite'
import type { MaintenanceSnapshot } from '@webvue/contracts'
import MaintenanceSettings from '../../app/components/settings/MaintenanceSettings.vue'
import { ApiError } from '../../app/composables/useApi'
import { storyContext } from '../support/context'

const snapshot: MaintenanceSnapshot = {
  preference: { id: 1, timezone: 'Asia/Riyadh', weekday: 4, startMinute: 120, durationMinutes: 60, revision: 1 },
  releases: { items: [
    { id: 1, releaseId: '19.0.2.0.0', deadlineAt: '2030-02-01T00:00:00Z', estimatedSeconds: 180, scope: 'tenant', status: 'supported', urgency: 'normal', policy: 'يحدد المشغل آخر موعد ومسار الترقية المدعوم لكل إصدار.' },
    { id: 2, releaseId: 'ai-state-3', deadlineAt: '2030-02-02T00:00:00Z', estimatedSeconds: 90, scope: 'ai_service', status: 'supported', urgency: 'security', policy: 'تحديث أمني مشترك؛ ينسق المشغل الموعد لجميع العملاء المتأثرين.' },
  ], total: 2 },
  bookings: { items: [{ id: 1, releaseId: 1, scheduledAt: '2030-01-25T23:00:00Z', timezone: 'Asia/Riyadh', durationMinutes: 60, status: 'scheduled', revision: 1 }], total: 1 },
}
const meta = {
  title: 'Settings/MaintenanceSettings', component: MaintenanceSettings,
  parameters: { layout: 'padded', ...storyContext('apps/web/app/pages/settings/system/index.vue:25'), a11y: { test: 'error' } },
  args: {
    snapshot,
    savePreference: async value => ({ ...value, id: 1, revision: value.revision + 1 }),
    reload: async () => snapshot,
    book: async () => undefined,
    updateBooking: async () => undefined,
  },
} satisfies Meta<typeof MaintenanceSettings>
export default meta
type Story = StoryObj<typeof meta>
export const PublishedUpdates: Story = {}
export const Empty: Story = { args: { snapshot: { preference: null, releases: { items: [], total: 0 }, bookings: { items: [], total: 0 } } } }
export const Running: Story = { args: { snapshot: { ...snapshot, bookings: { items: [{ ...snapshot.bookings.items[0]!, status: 'running' }], total: 1 } } } }
export const FailedSave: Story = { args: { savePreference: async () => { throw new ApiError(422, 'invalid', 'تعذر الحفظ؛ بقيت المسودة لإعادة المحاولة.') } } }
