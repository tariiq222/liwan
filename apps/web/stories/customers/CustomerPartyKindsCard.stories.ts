import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse } from 'msw'
import CustomerPartyKindsCard from '../../app/components/customers/settings/CustomerPartyKindsCard.vue'
import { me } from '../fixtures/pmo'
import { storyContext } from '../support/context'
import { settings } from './customerFixtures'

const manage = http.get('/api/v1/me', () => HttpResponse.json({ ...me, capabilities: ['customers.settings.manage'] }))
const save = http.patch('/api/v1/customers/settings', async ({ request }) => HttpResponse.json({ ...settings, ...await request.json() as object, revision: 4 }))

const meta = {
  title: 'Customers/CustomerPartyKindsCard',
  component: CustomerPartyKindsCard,
  parameters: {
    layout: 'padded',
    ...storyContext('apps/web/app/pages/settings/apps/customers/index.vue:32', 'بطاقة أنواع العملاء: أفراد أو شركات أو كلاهما. تحدد نموذج العميل الجديد ولا تغيّر العملاء الحاليين.'),
    msw: { handlers: { api: [manage, save] } },
  },
  args: { settings, canEdit: true, reloadSettings: async () => ({ ...settings, revision: 4 }) },
} satisfies Meta<typeof CustomerPartyKindsCard>
export default meta
type Story = StoryObj<typeof meta>

export const Both: Story = { name: 'أفراد وشركات' }
export const Individuals: Story = { name: 'أفراد', args: { settings: { ...settings, party_kinds: 'individuals' } } }
export const Companies: Story = { name: 'شركات', args: { settings: { ...settings, party_kinds: 'companies' } } }
export const ViewOnly: Story = { name: 'للعرض فقط', args: { canEdit: false } }
