import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { ref } from 'vue'
import ProductTaxField from '../../app/components/products/ProductTaxField.vue'
import { storyContext } from '../support/context'
import { products, taxChoices } from './productFixtures'

const meta = {
  title: 'Products/ProductTaxField',
  component: ProductTaxField,
  parameters: {
    layout: 'padded',
    ...storyContext('apps/web/app/components/products/ProductForm.vue:142', 'ضريبة المنتج: اختيار واحد من ضرائب المنشأة بالاسم والنسبة، والمعطّلة تنبّه أنها ستُفعَّل عند اختيارها. المنتج بأكثر من ضريبة يعرضها للقراءة ولا تُستبدل إلا باختيار ضريبة.'),
  },
  args: { modelValue: null, choices: taxChoices },
  render: args => ({
    components: { ProductTaxField },
    setup: () => ({ args, picked: ref(args.modelValue) }),
    template: '<div class="max-w-md"><ProductTaxField v-bind="args" v-model="picked" /></div>',
  }),
} satisfies Meta<typeof ProductTaxField>
export default meta
type Story = StoryObj<typeof meta>

export const NewProduct: Story = { name: 'منتج جديد' }
export const OneTax: Story = { name: 'منتج بضريبة واحدة', args: { taxes: products[0]!.taxes } }
export const SeveralTaxes: Story = { name: 'منتج بأكثر من ضريبة', args: { taxes: products[1]!.taxes } }
export const ChoicesUnreadable: Story = { name: 'تعذّرت قراءة الضرائب (يُدار من شركة أخرى)', args: { taxes: products[0]!.taxes, choices: [] } }
export const Disabled: Story = { name: 'معطّل', args: { taxes: products[0]!.taxes, disabled: true } }
export const Refused: Story = { name: 'رفضها الخادم', args: { error: 'لم يقبل النظام هذه الضريبة' } }
