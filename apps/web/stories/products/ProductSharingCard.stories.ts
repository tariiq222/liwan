import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse } from 'msw'
import ProductSharingCard from '../../app/components/products/settings/ProductSharingCard.vue'
import { storyContext } from '../support/context'
import { meWith, settings } from './productFixtures'

const manage = http.get('/api/v1/me', () => HttpResponse.json(meWith(['products.settings.manage'])))
const save = http.patch('/api/v1/products/settings', async ({ request }) => HttpResponse.json({ ...settings, ...await request.json() as object, revision: 4 }))
const refuse = (status: number, body: object) => ({ parameters: { msw: { handlers: { api: [manage, http.patch('/api/v1/products/settings', () => HttpResponse.json(body, { status }))] } } } })

const meta = {
  title: 'Products/ProductSharingCard',
  component: ProductSharingCard,
  parameters: {
    layout: 'padded',
    ...storyContext('apps/web/app/pages/settings/apps/products/index.vue:28', 'بطاقة مشاركة المنتجات: منتجات كل فرع أو منتجات المنشأة كلها، مع تنبيه نتائج المشاركة قبل الاختيار. يُحفظ الإعداد مع رقم المراجعة، ويبقى القديم إن رفض الخادم النقل.'),
    msw: { handlers: { api: [manage, save] } },
  },
  args: { settings, canEdit: true, reloadSettings: async () => ({ ...settings, revision: 4 }) },
} satisfies Meta<typeof ProductSharingCard>
export default meta
type Story = StoryObj<typeof meta>

export const Establishment: Story = { name: 'منتجات المنشأة كلها' }
export const Branch: Story = { name: 'منتجات كل فرع', args: { settings: { ...settings, sharing: 'branch' } } }
export const ViewOnly: Story = { name: 'للعرض فقط', args: { canEdit: false, settings: { ...settings, can_manage: false } } }
export const TransferRequired: Story = { name: 'النقل غير متاح بعد', ...refuse(409, { code: 'sharing_transfer_required', message: 'products exist', field: 'sharing' }) }
export const Conflict: Story = { name: 'تعارض المراجعة', ...refuse(409, { code: 'conflict', message: 'Product settings changed; reload before saving' }) }
