import type { Meta, StoryObj } from '@storybook/vue3-vite'
import SalesOrderLinesPanel from '../../app/components/sales/SalesOrderLinesPanel.vue'
import { storyContext } from '../support/context'
import { draftOrder } from './salesFixtures'

const meta = {
  title: 'Sales/SalesOrderLinesPanel',
  component: SalesOrderLinesPanel,
  parameters: { layout: 'padded', ...storyContext('apps/web/app/pages/sales/[id].vue:135', 'بنود المستند للعرض مع المبالغ والإجماليات المحفوظة.') },
  args: { order: draftOrder },
} satisfies Meta<typeof SalesOrderLinesPanel>
export default meta
type Story = StoryObj<typeof meta>

export const Lines: Story = { name: 'بنود' }
export const Empty: Story = { name: 'بلا بنود', args: { order: { ...draftOrder, lines: [] } } }
