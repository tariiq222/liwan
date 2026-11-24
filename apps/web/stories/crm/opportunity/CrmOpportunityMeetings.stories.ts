import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { fn } from 'storybook/test'
import CrmOpportunityMeetings from '../../../app/components/crm/opportunity/CrmOpportunityMeetings.vue'
import { storyContext } from '../../support/context'

const meetings = [
  { id: 8, name: 'عرض المنتج للعميل', reference: 'MTG-008', meeting_date: '2026-11-22', start_datetime: null, end_datetime: null, state: 'confirmed', organizer: { id: 3, name: 'ليلى الحربي' }, open_resolution_count: 0, series_id: null, project_id: null },
  { id: 9, name: 'مراجعة العرض السعري', reference: 'MTG-009', meeting_date: null, start_datetime: null, end_datetime: null, state: 'draft', organizer: null, open_resolution_count: 0, series_id: null, project_id: null },
] as const

const meta = {
  title: 'CRM/CrmOpportunityMeetings',
  component: CrmOpportunityMeetings,
  parameters: storyContext('apps/web/app/pages/crm/opportunities/[id].vue:200', 'اجتماعات الفرصة (جسر مع تطبيق الاجتماعات): الاسم والتاريخ والحالة مع رابط الاجتماع، ونموذج إضافة اجتماع داخل الصفحة.'),
  args: { meetings: [...meetings], total: meetings.length, canWrite: true, onCreate: fn(), onRetry: fn() },
} satisfies Meta<typeof CrmOpportunityMeetings>
export default meta
type Story = StoryObj<typeof meta>

export const WithMeetings: Story = { name: 'مع اجتماعات' }
export const ReadOnly: Story = { name: 'قراءة فقط', args: { canWrite: false } }
export const Empty: Story = { name: 'فارغ', args: { meetings: [], total: 0 } }
