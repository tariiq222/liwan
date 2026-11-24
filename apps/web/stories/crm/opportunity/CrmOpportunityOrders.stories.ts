import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { fn } from 'storybook/test'
import CrmOpportunityOrders from '../../../app/components/crm/opportunity/CrmOpportunityOrders.vue'
import { storyContext } from '../../support/context'
import { orders } from '../../sales/salesFixtures'

const rows = [orders[0]!, orders[1]!, orders[2]!]
const meta = {
  title: 'CRM/CrmOpportunityOrders',
  component: CrmOpportunityOrders,
  parameters: storyContext('apps/web/app/pages/crm/opportunities/[id].vue:389', 'عروض الأسعار والطلبات على الفرصة (جسر مع المبيعات): الرقم برابط صفحته والحالة والإجمالي والمندوب، وإجراء كتابة عرض سعر للعميل المربوط بالفرصة.'),
  args: { orders: rows, total: rows.length, canWrite: true, blocked: null, onCreate: fn(), onRetry: fn() },
} satisfies Meta<typeof CrmOpportunityOrders>
export default meta
type Story = StoryObj<typeof meta>

export const WithOrders: Story = { name: 'مع عروض وطلبات' }
export const WonByOrder: Story = { name: 'تُربح الفرصة بالطلب', args: { winByOrder: true } }
export const ReadOnly: Story = { name: 'قراءة فقط', args: { canWrite: false } }
export const NoCustomer: Story = { name: 'الفرصة بلا عميل', args: { blocked: 'noCustomer', orders: [], total: 0 } }
export const Closed: Story = { name: 'فرصة مغلقة', args: { blocked: 'closed' } }
export const Failed: Story = { name: 'رفض الخادم', args: { formError: 'اربط الفرصة بعميل أولًا ثم اكتب عرض السعر.' } }
export const Empty: Story = { name: 'فارغ', args: { orders: [], total: 0 } }
export const Loading: Story = { name: 'جارٍ التحميل', args: { orders: [], total: 0, loading: true } }
export const MoreThanShown: Story = { name: 'المزيد غير معروض', args: { total: 60 } }
