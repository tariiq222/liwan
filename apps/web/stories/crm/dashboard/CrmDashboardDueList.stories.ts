import type { Meta, StoryObj } from '@storybook/vue3-vite'
import CrmDashboardDueList from '../../../app/components/crm/dashboard/CrmDashboardDueList.vue'
import { storyContext } from '../../support/context'
import { lostReasons, outcomes, packages } from '../opportunity/crmOpportunityFixtures'
import { opportunities } from './crmDashboardFixtures'

const meta = {
  title: 'CRM/CrmDashboardDueList',
  component: CrmDashboardDueList,
  parameters: storyContext('apps/web/app/pages/crm/index.vue:75', 'مكالمات المسؤول المستحقة الآن: الهاتف رابط tel: و«سجّل النتيجة» يفتح نموذج المكالمة داخل الصف.'),
  args: { items: opportunities, total: 2, viewAllTo: '/crm/opportunities?due=1', now: Date.parse('2026-10-28T12:00:00Z'), canRecord: true, outcomes, packages, lostReasons },
} satisfies Meta<typeof CrmDashboardDueList>
export default meta
type Story = StoryObj<typeof meta>
export const Due: Story = {}
export const MoreThanShown: Story = { args: { total: 12 } }
export const Nothing: Story = { args: { items: [], total: 0 } }
export const RecordingOpen: Story = { args: { openId: 1 } }
export const Refused: Story = { args: { openId: 1, failure: 'تم تغيير الفرصة أو إغلاقها. حدّث الصفحة وحاول مجددًا.' } }
export const Loading: Story = { args: { items: [], total: 0, loading: true } }
export const LoadFailed: Story = { args: { items: [], total: 0, error: new Error('failed') } }
export const ReadOnly: Story = { args: { canRecord: false } }
