import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse } from 'msw'
import SalesOpportunityCard from '../../app/components/sales/settings/SalesOpportunityCard.vue'
import { storyContext } from '../support/context'
import { meWith, salesSettingsWithOpportunity } from './salesFixtures'

const manage = http.get('/api/v1/me', () => HttpResponse.json(meWith(['sales.settings.manage'])))
const save = http.patch('/api/v1/sales/settings', async ({ request }) => HttpResponse.json({ ...salesSettingsWithOpportunity, ...await request.json() as object, revision: 4 }))

const meta = {
  title: 'Sales/SalesOpportunityCard',
  component: SalesOpportunityCard,
  parameters: { layout: 'padded', ...storyContext('apps/web/app/pages/settings/apps/sales/index.vue:34', 'إعداد ربح الفرصة بالطلب: متى يربح الطلب المؤكد الفرصة التي كُتب منها، وبأي مبلغ.'), msw: { handlers: { api: [manage, save] } } },
  args: { settings: salesSettingsWithOpportunity, canEdit: true, reloadSettings: async () => ({ ...salesSettingsWithOpportunity, revision: 4 }) },
} satisfies Meta<typeof SalesOpportunityCard>
export default meta
type Story = StoryObj<typeof meta>

export const Editable: Story = { name: 'قابل للتعديل' }
export const ManualAndTaxed: Story = { name: 'يدويًا وبعد الضريبة', args: { settings: { ...salesSettingsWithOpportunity, opportunity_win: 'manual', opportunity_win_amount: 'total' } } }
export const ViewOnly: Story = { name: 'للعرض فقط', args: { canEdit: false, settings: { ...salesSettingsWithOpportunity, can_manage: false } } }
