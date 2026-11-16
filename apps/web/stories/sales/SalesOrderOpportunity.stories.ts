import type { Meta, StoryObj } from '@storybook/vue3-vite'
import SalesOrderOpportunity from '../../app/components/sales/SalesOrderOpportunity.vue'
import { storyContext } from '../support/context'
import { orderOpportunity } from './salesFixtures'

const meta = {
  title: 'Sales/SalesOrderOpportunity',
  component: SalesOrderOpportunity,
  parameters: { layout: 'padded', ...storyContext('apps/web/app/pages/sales/[id].vue:176', 'الفرصة التي كُتب منها عرض السعر في صفحة السجل: اسمها برابط صفحتها وحالتها، ولا تظهر إلا لمن يقرؤها في إدارة العلاقات.') },
  args: { opportunity: orderOpportunity },
} satisfies Meta<typeof SalesOrderOpportunity>
export default meta
type Story = StoryObj<typeof meta>

export const Open: Story = { name: 'فرصة مفتوحة' }
export const Won: Story = { name: 'فرصة مربوحة', args: { opportunity: { ...orderOpportunity, status: 'won' } } }
export const Lost: Story = { name: 'فرصة خاسرة', args: { opportunity: { ...orderOpportunity, status: 'lost', active: false } } }
