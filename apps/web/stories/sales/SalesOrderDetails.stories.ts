import type { Meta, StoryObj } from '@storybook/vue3-vite'
import SalesOrderDetails from '../../app/components/sales/SalesOrderDetails.vue'
import { storyContext } from '../support/context'
import { draftOrder, onlineOrder } from './salesFixtures'

const meta = {
  title: 'Sales/SalesOrderDetails',
  component: SalesOrderDetails,
  parameters: { layout: 'padded', ...storyContext('apps/web/app/pages/sales/[id].vue:115', 'جانب المستند: العميل والمندوب والمصدر والتواريخ والشروط.') },
  args: { order: draftOrder },
} satisfies Meta<typeof SalesOrderDetails>
export default meta
type Story = StoryObj<typeof meta>

export const Quotation: Story = { name: 'عرض سعر' }
export const Online: Story = { name: 'طلب إلكتروني', args: { order: onlineOrder } }
