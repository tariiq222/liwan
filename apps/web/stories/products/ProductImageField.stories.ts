import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { ref } from 'vue'
import ProductImageField from '../../app/components/products/ProductImageField.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Products/ProductImageField',
  component: ProductImageField,
  parameters: {
    layout: 'padded',
    ...storyContext('apps/web/app/components/products/ProductForm.vue:144', 'صورة المنتج: اختيار ملف JPEG أو PNG ومعاينته قبل الحفظ، أو حذف الصورة المحفوظة. الخادم لا يعيد الملف المحفوظ فلا معاينة له، وغير المعدّلة لا تُرسل.'),
  },
  args: { modelValue: { kind: 'keep' }, stored: false },
  render: args => ({
    components: { ProductImageField },
    setup: () => ({ args, change: ref(args.modelValue) }),
    template: '<div class="max-w-xl"><ProductImageField v-bind="args" v-model="change" /></div>',
  }),
} satisfies Meta<typeof ProductImageField>
export default meta
type Story = StoryObj<typeof meta>

export const NoImage: Story = { name: 'بلا صورة' }
export const Stored: Story = { name: 'له صورة محفوظة', args: { stored: true } }
export const WillRemove: Story = { name: 'ستُحذف الصورة', args: { stored: true, modelValue: { kind: 'remove' } } }
export const Disabled: Story = { name: 'معطّل', args: { stored: true, disabled: true } }
export const Refused: Story = { name: 'رفضها الخادم', args: { error: 'لم يقبل النظام هذه الصورة. تأكد أنها JPEG أو PNG فعلًا' } }
