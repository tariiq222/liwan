import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { fn } from 'storybook/test'
import CrmOpportunityTasks from '../../../app/components/crm/opportunity/CrmOpportunityTasks.vue'
import { storyContext } from '../../support/context'

const tasks = [
  { id: 5, name: 'اتصال متابعة بعد العرض', state: 'open', priority: 'high', date_deadline: '2026-11-20T09:00:00Z', assignees: [{ id: 3, name: 'ليلى الحربي' }], source: 'personal', project: null, href: '/my-tasks/5' },
  { id: 6, name: 'إرسال عقد الباقة', state: 'done', priority: 'normal', date_deadline: '2026-11-12T09:00:00Z', assignees: [{ id: 4, name: 'سعد الدوسري' }], source: 'personal', project: null, href: '/my-tasks/6' },
] as const

const meta = {
  title: 'CRM/CrmOpportunityTasks',
  component: CrmOpportunityTasks,
  parameters: storyContext('apps/web/app/pages/crm/opportunities/[id].vue:357', 'مهام المتابعة على الفرصة (جسر مع تطبيق المهام): الحالة والموعد والمكلّفون مع رابط المهمة، ونموذج إضافة مهمة داخل الصفحة.'),
  args: { tasks: [...tasks], total: tasks.length, canWrite: true, onCreate: fn(), onRetry: fn() },
} satisfies Meta<typeof CrmOpportunityTasks>
export default meta
type Story = StoryObj<typeof meta>

export const WithTasks: Story = { name: 'مع مهام' }
export const ReadOnly: Story = { name: 'قراءة فقط', args: { canWrite: false } }
export const Empty: Story = { name: 'فارغ', args: { tasks: [], total: 0 } }
export const Loading: Story = { name: 'جارٍ التحميل', args: { tasks: [], total: 0, loading: true } }
export const MoreThanShown: Story = { name: 'المزيد غير معروض', args: { total: 60 } }
