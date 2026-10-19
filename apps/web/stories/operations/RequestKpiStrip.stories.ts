import type { Meta, StoryObj } from '@storybook/vue3-vite'
import RequestKpiStrip from '../../app/components/operations/RequestKpiStrip.vue'
import { storyContext } from '../support/context'
import { operationHandlers } from './fixtures'

// The strip counts with one-row requests to GET /api/v1/operations/requests, answered by operationHandlers with totals that differ by state.
const meta = {
  title: 'Operations/RequestKpiStrip',
  component: RequestKpiStrip,
  parameters: { layout: 'padded', ...storyContext('apps/web/app/pages/operations/index.vue:10', 'بطاقات مدمجة فوق قائمة الطلبات: أعداد من إجمالي الخادم لكل حالة، وكل بطاقة رابط إلى القائمة بنفس الحالة.'), msw: { handlers: { api: operationHandlers } } },
  args: { scope: 'mine' },
  render: args => ({ components: { RequestKpiStrip }, setup: () => ({ args }), template: '<div class="max-w-5xl"><RequestKpiStrip v-bind="args" /></div>' }),
} satisfies Meta<typeof RequestKpiStrip>
export default meta
type Story = StoryObj<typeof meta>
export const Mine: Story = { name: 'طلباتي' }
export const Pending: Story = { name: 'بانتظار مراجعتي', args: { scope: 'pending' } }
export const Monitoring: Story = { name: 'متابعة الطلبات', args: { scope: 'monitoring' } }
