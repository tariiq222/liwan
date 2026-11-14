import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { ref } from 'vue'
import { http, HttpResponse } from 'msw'
import CustomerPicker from '../../app/components/shared/form/CustomerPicker.vue'
import { storyContext } from '../support/context'
import { meWith } from '../sales/salesFixtures'

const meta = {
  title: 'Shared/CustomerPicker',
  component: CustomerPicker,
  parameters: storyContext('apps/web/app/components/sales/SalesOrderForm.vue:81', 'يبحث في /api/v1/customers/pick ويعرض الاسم والنوع وآخر أربعة أرقام من الجوال. لا ينشئ عميلًا.'),
  args: { modelValue: null },
  render: args => ({
    components: { CustomerPicker },
    setup: () => ({ args, value: ref(args.modelValue) }),
    template: '<div class="grid max-w-sm gap-1"><span class="text-sm font-medium text-highlighted">العميل</span><CustomerPicker v-bind="args" v-model="value" /></div>',
  }),
} satisfies Meta<typeof CustomerPicker>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { name: 'اختيار عميل' }
export const Selected: Story = { name: 'عميل مختار', args: { modelValue: 2, selected: { id: 2, name: 'مؤسسة النخيل' } } }
export const Disabled: Story = { name: 'معطّل', args: { disabled: true } }

const noCustomers = (capabilities: string[]) => ({ msw: { handlers: { api: [
  http.get('/api/v1/me', () => HttpResponse.json(meWith(capabilities))),
  http.get('/api/v1/customers/pick', () => HttpResponse.json({ items: [], total: 0 })),
] } } })
export const EmptyWithCreateLink: Story = { name: 'لا عملاء: رابط إضافة عميل لمن يديرهم', parameters: noCustomers(['sales.quotations.manage', 'customers.manage']) }
export const EmptyForAgent: Story = { name: 'لا عملاء: نص فقط', parameters: noCustomers(['sales.quotations.manage']) }
