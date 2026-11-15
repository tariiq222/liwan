import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse } from 'msw'
import CustomerAutoLinkCard from '../../app/components/customers/settings/CustomerAutoLinkCard.vue'
import { me } from '../fixtures/pmo'
import { storyContext } from '../support/context'
import { settings } from './customerFixtures'

const manage = http.get('/api/v1/me', () => HttpResponse.json({ ...me, capabilities: ['customers.settings.manage'] }))
const save = http.patch('/api/v1/customers/settings', async ({ request }) => HttpResponse.json({ ...settings, ...await request.json() as object, revision: 4 }))

const meta = {
  title: 'Customers/CustomerAutoLinkCard',
  component: CustomerAutoLinkCard,
  parameters: {
    layout: 'padded',
    ...storyContext('apps/web/app/pages/settings/apps/customers/index.vue:35', 'بطاقة الربط التلقائي: تربط جهة الاتصال الجديدة بالعميل الوحيد المطابق لرقمها دون تدخل الموظف. مطفأة افتراضيًا ولا تغيّر جهات الاتصال الحالية.'),
    msw: { handlers: { api: [manage, save] } },
  },
  args: { settings, canEdit: true, reloadSettings: async () => ({ ...settings, revision: 4 }) },
} satisfies Meta<typeof CustomerAutoLinkCard>
export default meta
type Story = StoryObj<typeof meta>

export const Off: Story = { name: 'مطفأ' }
export const On: Story = { name: 'مفعّل', args: { settings: { ...settings, auto_link_single_match: true } } }
export const ViewOnly: Story = { name: 'للعرض فقط', args: { canEdit: false } }
