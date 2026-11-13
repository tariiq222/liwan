import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse } from 'msw'
import CustomerSharingCard from '../../app/components/customers/settings/CustomerSharingCard.vue'
import { me } from '../fixtures/pmo'
import { storyContext } from '../support/context'
import { settings } from './customerFixtures'

const manage = http.get('/api/v1/me', () => HttpResponse.json({ ...me, capabilities: ['customers.settings.manage'] }))
const save = http.patch('/api/v1/customers/settings', async ({ request }) => HttpResponse.json({ ...settings, ...await request.json() as object, revision: 4 }))
const refuse = (status: number, body: object) => ({ parameters: { msw: { handlers: { api: [manage, http.patch('/api/v1/customers/settings', () => HttpResponse.json(body, { status }))] } } } })

const meta = {
  title: 'Customers/CustomerSharingCard',
  component: CustomerSharingCard,
  parameters: {
    layout: 'padded',
    ...storyContext('apps/web/app/pages/settings/apps/customers/index.vue:31', 'بطاقة مشاركة العملاء: عملاء كل فرع أو عملاء المنشأة كلها، مع تنبيه نتائج المشاركة قبل الاختيار. يُحفظ الإعداد مع رقم المراجعة، ويبقى القديم إن رفض الخادم النقل.'),
    msw: { handlers: { api: [manage, save] } },
  },
  args: { settings, canEdit: true, reloadSettings: async () => ({ ...settings, revision: 4 }) },
} satisfies Meta<typeof CustomerSharingCard>
export default meta
type Story = StoryObj<typeof meta>

export const Branch: Story = { name: 'عملاء كل فرع' }
export const Establishment: Story = { name: 'عملاء المنشأة كلها', args: { settings: { ...settings, sharing: 'establishment' } } }
export const ViewOnly: Story = { name: 'للعرض فقط', args: { canEdit: false } }
export const TransferRequired: Story = { name: 'النقل غير متاح بعد', ...refuse(409, { code: 'sharing_transfer_required', message: 'customers exist', field: 'sharing' }) }
export const Conflict: Story = { name: 'تعارض المراجعة', ...refuse(409, { code: 'conflict', message: 'Customer settings changed; reload before saving' }) }
