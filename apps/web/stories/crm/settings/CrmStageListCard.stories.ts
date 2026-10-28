import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse } from 'msw'
import CrmStageListCard from '../../../app/components/crm/settings/CrmStageListCard.vue'
import { storyContext } from '../../support/context'
import { me } from '../../fixtures/pmo'

const manage = http.get('/api/v1/me', () => HttpResponse.json({ ...me, capabilities: ['crm.settings.read', 'crm.settings.manage'] }))
const stages = [
  { id: 1, name: 'جديد', sequence: 10, is_won: false, active: true },
  { id: 2, name: 'تم التواصل', sequence: 20, is_won: false, active: true },
  { id: 3, name: 'مهتم', sequence: 30, is_won: false, active: true },
  { id: 4, name: 'تم البيع', sequence: 40, is_won: true, active: true },
  { id: 5, name: 'قديمة', sequence: 50, is_won: false, active: false },
]
const list = (items: typeof stages) => http.get('/api/v1/crm/stages', () => HttpResponse.json({ items, total: items.length }))
const meta = {
  title: 'CRM/CrmStageListCard',
  component: CrmStageListCard,
  parameters: {
    ...storyContext('apps/web/app/pages/settings/apps/crm/index.vue:58', 'مراحل مسار الفرصة: إعادة تسمية وترتيب وأرشفة، ومرحلة واحدة للبيع.'),
    msw: { handlers: { api: [manage, list(stages)] } },
  },
  args: { canEdit: true },
} satisfies Meta<typeof CrmStageListCard>
export default meta
type Story = StoryObj<typeof meta>
export const Pipeline: Story = {}
export const ReadOnly: Story = { args: { canEdit: false } }
export const Empty: Story = { parameters: { msw: { handlers: { api: [manage, list([])] } } } }
export const OrderRefused: Story = {
  parameters: { msw: { handlers: { api: [manage, list(stages), http.post('/api/v1/crm/stages/order', () => HttpResponse.json({ code: 'invalid', message: 'ids must list every active stage exactly once' }, { status: 422 }))] } } },
}
