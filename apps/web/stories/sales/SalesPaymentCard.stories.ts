import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse } from 'msw'
import SalesPaymentCard from '../../app/components/sales/settings/SalesPaymentCard.vue'
import { storyContext } from '../support/context'
import { meWith, salesSettingsWithPayment } from './salesFixtures'

const manage = http.get('/api/v1/me', () => HttpResponse.json(meWith(['sales.settings.manage'])))
const save = http.patch('/api/v1/sales/settings', async ({ request }) => HttpResponse.json({ ...salesSettingsWithPayment, ...await request.json() as object, revision: 4 }))
const refused = http.patch('/api/v1/sales/settings', () => HttpResponse.json({ code: 'invalid', message: 'bad', field: 'prepayment_percent' }, { status: 422 }))

const meta = {
  title: 'Sales/SalesPaymentCard',
  component: SalesPaymentCard,
  parameters: { layout: 'padded', ...storyContext('apps/web/app/pages/settings/apps/sales/index.vue:33', 'إعداد طريقة دفع عروض الأسعار الجديدة: بلا دفع، أو كامل الإجمالي، أو نسبة منه.'), msw: { handlers: { api: [manage, save] } } },
  args: { settings: salesSettingsWithPayment, canEdit: true, reloadSettings: async () => ({ ...salesSettingsWithPayment, revision: 4 }) },
} satisfies Meta<typeof SalesPaymentCard>
export default meta
type Story = StoryObj<typeof meta>

export const Editable: Story = { name: 'قابل للتعديل' }
export const Percent: Story = { name: 'نسبة من الإجمالي', args: { settings: { ...salesSettingsWithPayment, payment_to_confirm: 'percent', prepayment_percent: 30 } } }
export const ViewOnly: Story = { name: 'للعرض فقط', args: { canEdit: false, settings: { ...salesSettingsWithPayment, payment_to_confirm: 'full', can_manage: false } } }
export const Refused: Story = { name: 'رفض الخادم للنسبة', args: { settings: { ...salesSettingsWithPayment, payment_to_confirm: 'percent' } }, parameters: { msw: { handlers: { api: [manage, refused] } } } }
