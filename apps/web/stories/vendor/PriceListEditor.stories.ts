import type { Meta, StoryObj } from '@storybook/vue3-vite'
import PriceListEditor from '../../app/components/vendor/PriceListEditor.vue'
import { storyContext } from '../support/context'
const meta = { title: 'Vendor/PriceListEditor', component: PriceListEditor, parameters: { layout: 'padded', ...storyContext('apps/web/app/components/vendor/BundleForm.vue:90') }, args: { label: 'الأسعار', modelValue: [{ unit: 'month', count: '1', amount: '100.00' }] } } satisfies Meta<typeof PriceListEditor>
export default meta
type Story = StoryObj<typeof meta>
export const Filled: Story = {}
export const Empty: Story = { args: { modelValue: [] } }
export const Invalid: Story = { args: { showErrors: true, modelValue: [{ unit: '', count: '1', amount: '' }] } }
