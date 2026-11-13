import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse } from 'msw'
import CustomerPhoneCountryCard from '../../app/components/customers/settings/CustomerPhoneCountryCard.vue'
import { me } from '../fixtures/pmo'
import { storyContext } from '../support/context'
import { settings } from './customerFixtures'

const countries = [
  { id: 63, code: 'AE', name: 'الإمارات العربية المتحدة' },
  { id: 191, code: 'SA', name: 'المملكة العربية السعودية' },
  { id: 65, code: 'EG', name: 'مصر' },
]
const manage = http.get('/api/v1/me', () => HttpResponse.json({ ...me, capabilities: ['customers.settings.manage'] }))
const list = http.get('/api/v1/customers/settings/countries', () => HttpResponse.json({ items: countries, total: countries.length }))
const save = http.patch('/api/v1/customers/settings', async ({ request }) => HttpResponse.json({ ...settings, ...await request.json() as object, revision: 4 }))

const meta = {
  title: 'Customers/CustomerPhoneCountryCard',
  component: CustomerPhoneCountryCard,
  parameters: {
    layout: 'padded',
    ...storyContext('apps/web/app/pages/settings/apps/customers/index.vue:33', 'بطاقة دولة الجوال الافتراضية: قائمة بحث بكل الدول مع خيار «دولة الشركة الرئيسية» الذي يُحفظ فارغًا. للعرض فقط لا تجلب القائمة.'),
    msw: { handlers: { api: [manage, list, save] } },
  },
  args: { settings, canEdit: true, reloadSettings: async () => ({ ...settings, revision: 4 }) },
} satisfies Meta<typeof CustomerPhoneCountryCard>
export default meta
type Story = StoryObj<typeof meta>

export const Saudi: Story = { name: 'السعودية' }
export const MainCompanyCountry: Story = { name: 'دولة الشركة الرئيسية', args: { settings: { ...settings, phone_country: null } } }
export const ViewOnly: Story = { name: 'للعرض فقط', args: { canEdit: false } }
export const ListFails: Story = { name: 'تعذّر تحميل الدول', parameters: { msw: { handlers: { api: [manage, http.get('/api/v1/customers/settings/countries', () => HttpResponse.json({ code: 'unavailable', message: 'down' }, { status: 503 })), save] } } } }
