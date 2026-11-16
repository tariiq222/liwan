import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse } from 'msw'
import SalesInvoicingCard from '../../app/components/sales/settings/SalesInvoicingCard.vue'
import { storyContext } from '../support/context'
import { meWith, salesSettingsWithInvoicing } from './salesFixtures'

const manage = http.get('/api/v1/me', () => HttpResponse.json(meWith(['sales.settings.manage'])))
const save = http.patch('/api/v1/sales/settings', async ({ request }) => HttpResponse.json({ ...salesSettingsWithInvoicing, ...await request.json() as object, revision: 4 }))

const meta = {
  title: 'Sales/SalesInvoicingCard',
  component: SalesInvoicingCard,
  parameters: { layout: 'padded', ...storyContext('apps/web/app/pages/settings/apps/sales/index.vue:42', 'إعداد فوترة الطلبات: هل يجوز فوترة الطلب المؤكد بدفعة مقدمة أم كاملًا فقط، ومن يفوتر طلب زميله.'), msw: { handlers: { api: [manage, save] } } },
  args: { settings: salesSettingsWithInvoicing, canEdit: true, reloadSettings: async () => ({ ...salesSettingsWithInvoicing, revision: 4 }) },
} satisfies Meta<typeof SalesInvoicingCard>
export default meta
type Story = StoryObj<typeof meta>

export const Editable: Story = { name: 'قابل للتعديل' }
export const DownPaymentsClosed: Story = { name: 'الدفعات المقدمة مغلقة', args: { settings: { ...salesSettingsWithInvoicing, invoice_down_payment: 'refuse' } } }
export const AnyBiller: Story = { name: 'أي موظف فوترة', args: { settings: { ...salesSettingsWithInvoicing, invoice_actor: 'any_biller' } } }
export const ViewOnly: Story = { name: 'للعرض فقط', args: { canEdit: false, settings: { ...salesSettingsWithInvoicing, can_manage: false } } }
