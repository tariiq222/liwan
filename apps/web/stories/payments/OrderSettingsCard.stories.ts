import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse, delay } from 'msw'
import type { PaymentSettings } from '@liwan/contracts'
import OrderSettingsCard from '../../app/components/payments/OrderSettingsCard.vue'
import { me } from '../fixtures/pmo'
import { storyContext } from '../support/context'

const settings: PaymentSettings = { unpaid_order_expiry_minutes: 60, invoice_when_paid: true, refund_policy: 'full', refund_amounts: 'due', revision: 3 }
const changedElsewhere: PaymentSettings = { unpaid_order_expiry_minutes: 120, invoice_when_paid: false, refund_policy: 'full', refund_amounts: 'due', revision: 4 }
const manage = http.get('/api/v1/me', () => HttpResponse.json({ ...me, capabilities: ['payments.settings.manage'] }))
const save = http.patch('/api/v1/payments/settings', async ({ request }) => HttpResponse.json({ ...settings, ...await request.json() as object, revision: 4 }))
const refuse = (status: number, body: object) => ({ parameters: { msw: { handlers: { api: [manage, http.patch('/api/v1/payments/settings', () => HttpResponse.json(body, { status }))] } } } })

const meta = {
  title: 'Payments/OrderSettingsCard',
  component: OrderSettingsCard,
  parameters: {
    layout: 'padded',
    ...storyContext('apps/web/app/pages/settings/apps/payments/index.vue:43', 'إعدادات الطلبات الإلكترونية: مهلة دفع الطلب غير المدفوع (للشركة الحالية) وإصدار الفاتورة عند الدفع (للحساب كله)، تُحفظ مع رقم المراجعة ويُعاد التحميل عند التعارض.'),
    msw: { handlers: { api: [manage, save] } },
  },
  args: { settings, canEdit: true, reloadSettings: async () => changedElsewhere },
} satisfies Meta<typeof OrderSettingsCard>
export default meta
type Story = StoryObj<typeof meta>

export const Defaults: Story = {}
export const InvoiceWhenPaidOff: Story = { args: { settings: { ...settings, invoice_when_paid: false } } }
export const ViewOnly: Story = { args: { canEdit: false } }
export const Saving: Story = { parameters: { msw: { handlers: { api: [manage, http.patch('/api/v1/payments/settings', async () => { await delay(10_000); return HttpResponse.json({ ...settings, revision: 4 }) })] } } } }
export const SaveError: Story = refuse(503, { code: 'unavailable', message: 'تعذّر حفظ الإعدادات الآن' })
export const ExpiryRefused: Story = refuse(422, { code: 'invalid', message: 'المهلة خارج الحدود المسموحة', field: 'unpaid_order_expiry_minutes' })
export const Conflict: Story = refuse(409, { code: 'conflict', message: 'Payment settings changed; reload before saving' })
export const ReloadFails: Story = { ...refuse(409, { code: 'conflict', message: 'Payment settings changed; reload before saving' }), args: { reloadSettings: async () => { throw new Error('offline') } } }
