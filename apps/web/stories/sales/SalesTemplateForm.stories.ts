import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse } from 'msw'
import SalesTemplateForm from '../../app/components/sales/SalesTemplateForm.vue'
import { storyContext } from '../support/context'
import { meWith } from './salesFixtures'
import { readyTemplate } from './salesTemplateFixtures'

const session = http.get('/api/v1/me', () => HttpResponse.json(meWith(['sales.settings.manage', 'products.read'])))
const handlers = (...extra: ReturnType<typeof http.get>[]) => ({ msw: { handlers: { api: [session, ...extra] } } })
const refuse = (body: object) => handlers(http.patch('/api/v1/sales/templates/4', () => HttpResponse.json(body, { status: 422 })))

const meta = {
  title: 'Sales/SalesTemplateForm',
  component: SalesTemplateForm,
  parameters: { layout: 'padded', ...storyContext('apps/web/app/pages/settings/apps/sales/templates/new.vue:21', 'نموذج قالب عرض السعر: الاسم والصلاحية والشروط والبنود. لا أسعار ولا خصومًا ولا ضرائب.'), ...handlers() },
  args: { backTo: '/settings/apps/sales/templates' },
} satisfies Meta<typeof SalesTemplateForm>
export default meta
type Story = StoryObj<typeof meta>

export const New: Story = { name: 'قالب جديد' }
export const Edit: Story = { name: 'تعديل', args: { template: readyTemplate } }
export const NameRefused: Story = { name: 'اسم مرفوض', args: { template: readyTemplate }, parameters: refuse({ code: 'invalid', message: 'bad', field: 'name' }) }
export const ProductRefused: Story = { name: 'منتج مرفوض', args: { template: readyTemplate }, parameters: refuse({ code: 'invalid', message: 'bad', field: 'lines.1.product_id' }) }
