import type { Meta, StoryObj } from '@storybook/vue3-vite'
import PersonalSummaryCard from '../../app/components/account/PersonalSummaryCard.vue'
import { storyContext } from '../support/context'
const meta = {
  title: 'Account/PersonalSummaryCard', component: PersonalSummaryCard,
  parameters: { layout: 'padded', ...storyContext('apps/web/app/pages/account/index.vue:36', 'بطاقة ملخص شخصية مع حالة تحميل وخطأ وإجراء مباشر وترتيب بلوحة المفاتيح.') },
  args: { entry: { id: 'hr-leave', section: 'leave', labelKey: 'hr.self.leave', descriptionKey: 'hr.self.leaveDesc', icon: 'i-lucide-calendar-days', to: '/account/leave', capability: 'hr.leave.read' }, data: { value: '18', caption: 'يومًا في رصيد الإجازة', rows: [{ id: 1, label: 'إجازة سنوية', caption: 'بانتظار الاعتماد', to: '/account/leave/1' }] }, action: { id: 'hr.new-leave', labelKey: 'hr.leave.new', icon: 'i-lucide-plus', to: '/account/leave/new', capability: 'hr.leave.request' } },
} satisfies Meta<typeof PersonalSummaryCard>
export default meta
type Story = StoryObj<typeof meta>
export const Ready: Story = {}
export const Loading: Story = { args: { pending: true, data: undefined } }
export const Failed: Story = { args: { error: { status: 503 }, data: undefined } }
export const Empty: Story = { args: { data: undefined, action: undefined } }
export const Reorder: Story = { args: { customize: true, first: true } }
