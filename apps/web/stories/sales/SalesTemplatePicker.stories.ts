import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse } from 'msw'
import { ref } from 'vue'
import SalesTemplatePicker from '../../app/components/sales/SalesTemplatePicker.vue'
import { storyContext } from '../support/context'
import { meWith } from './salesFixtures'
import { templateItems } from './salesTemplateFixtures'

const session = http.get('/api/v1/me', () => HttpResponse.json(meWith(['sales.read', 'sales.quotations.manage'])))
const list = (items: typeof templateItems) => http.get('/api/v1/sales/templates', () => HttpResponse.json({ items, total: items.length }))
const handlers = (items: typeof templateItems) => ({ msw: { handlers: { api: [session, list(items)] } } })

const meta = {
  title: 'Sales/SalesTemplatePicker',
  component: SalesTemplatePicker,
  parameters: { layout: 'padded', ...storyContext('apps/web/app/components/sales/SalesOrderForm.vue:116', 'البدء من قالب في عرض السعر الجديد: قالب واحد أو بلا قالب، وقالب فيه منتج غير متاح يظهر ولا يُختار.'), ...handlers(templateItems) },
  args: { modelValue: null },
  render: args => ({ components: { SalesTemplatePicker }, setup: () => ({ args, value: ref(args.modelValue) }), template: '<SalesTemplatePicker v-bind="args" v-model="value" />' }),
} satisfies Meta<typeof SalesTemplatePicker>
export default meta
type Story = StoryObj<typeof meta>

export const NoneChosen: Story = { name: 'بلا قالب' }
export const Chosen: Story = { name: 'قالب مختار', args: { modelValue: 4 } }
export const Refused: Story = { name: 'رفض الخادم', args: { modelValue: 4, error: 'لا يمكن بدء عرض السعر من هذا القالب: أحد منتجاته مؤرشف أو غير متاح لهذه الشركة.' } }
export const NoTemplates: Story = { name: 'لا قوالب (لا يظهر)', parameters: handlers([]) }
