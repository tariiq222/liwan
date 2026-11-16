import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { ref } from 'vue'
import SalesPaymentChoice from '../../app/components/sales/SalesPaymentChoice.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Sales/SalesPaymentChoice',
  component: SalesPaymentChoice,
  parameters: { layout: 'padded', ...storyContext('apps/web/app/components/sales/SalesOrderForm.vue:111', 'اختيار طريقة دفع عرض السعر: بلا دفع، أو كامل الإجمالي، أو نسبة منه.') },
  args: { modelValue: { mode: 'off', percent: 50 } },
  render: args => ({ components: { SalesPaymentChoice }, setup: () => ({ args, value: ref(args.modelValue) }), template: '<SalesPaymentChoice v-bind="args" v-model="value" />' }),
} satisfies Meta<typeof SalesPaymentChoice>
export default meta
type Story = StoryObj<typeof meta>

export const Off: Story = { name: 'بلا دفع' }
export const Full: Story = { name: 'كامل الإجمالي', args: { modelValue: { mode: 'full', percent: 50 } } }
export const Percent: Story = { name: 'نسبة من الإجمالي', args: { modelValue: { mode: 'percent', percent: 30 } } }
export const PercentEmpty: Story = { name: 'نسبة ناقصة', args: { modelValue: { mode: 'percent', percent: null }, percentError: 'اكتب رقمًا صحيحًا من 1 إلى 100.' } }
export const Disabled: Story = { name: 'معطّل', args: { modelValue: { mode: 'percent', percent: 30 }, disabled: true } }
