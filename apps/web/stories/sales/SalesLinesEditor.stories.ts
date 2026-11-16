import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { ref } from 'vue'
import SalesLinesEditor from '../../app/components/sales/SalesLinesEditor.vue'
import { salesDraftFromOrder } from '../../app/composables/sales/salesOrderDraft'
import { storyContext } from '../support/context'
import { draftOrder } from './salesFixtures'

const lines = salesDraftFromOrder(draftOrder).lines
const meta = {
  title: 'Sales/SalesLinesEditor',
  component: SalesLinesEditor,
  parameters: { layout: 'padded', ...storyContext('apps/web/app/components/sales/SalesOrderForm.vue:119', 'بنود عرض السعر: منتج من قائمة المنتجات بسعره للعرض فقط، وأقسام وملاحظات، مع الإضافة والحذف والترتيب.') },
  args: { modelValue: lines, errors: [] },
  render: args => ({ components: { SalesLinesEditor }, setup: () => ({ args, value: ref(args.modelValue) }), template: '<SalesLinesEditor v-bind="args" v-model="value" />' }),
} satisfies Meta<typeof SalesLinesEditor>
export default meta
type Story = StoryObj<typeof meta>

export const Lines: Story = { name: 'بنود' }
export const Errors: Story = { name: 'أخطاء', args: { errors: [{ name: true }, { quantity: true, discount: true }, {}] } }
export const Refused: Story = { name: 'رفض الخادم للخصم', args: { refused: { index: 1, field: 'discount_percent', message: 'هذا الخصم أعلى من الحد المسموح لك.' } } }
export const Empty: Story = { name: 'بلا بنود', args: { modelValue: [] } }
export const Disabled: Story = { name: 'معطّل', args: { disabled: true } }
export const Unpriced: Story = { name: 'بنود قالب (بلا أسعار)', args: { priced: false } }
