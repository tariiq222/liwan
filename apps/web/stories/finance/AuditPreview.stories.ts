import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse } from 'msw'
import { FinanceAuditEventListSchema, MeSchema } from '@webvue/contracts'
import AuditPreview from '../../app/components/finance/governance/AuditPreview.vue'
import { storyContext } from '../support/context'

const me = MeSchema.parse({
  id: 7, name: 'سارة القحطاني', login: 'sara', email: 'sara@example.com', lang: 'ar_001', tz: 'Asia/Riyadh', role: 'admin', roles: [],
  access_policy_version: 1, company: { id: 1, name: 'شركة المثال' }, capabilities: ['finance.audit.read'], modules: ['webvue_finance'],
  platform: { schema_version: 1, policy_revision: 1, state: 'active', valid_until: null, read_only: false, readable_features: ['finance.enabled'], writable_features: ['finance.enabled'] },
})
const events = FinanceAuditEventListSchema.parse({
  items: [
    { id: 5, action: 'fiscal_year_closed', actor: { id: 7, name: 'سارة القحطاني' }, created_at: '2030-01-15T10:30:00Z', res_model: 'account.fiscal.year', res_id: 2029, fields_written: ['lock_date'], outcome: null },
    { id: 4, action: 'zatca_submitted', actor: { id: 8, name: 'فهد الدوسري' }, created_at: '2030-01-14T09:00:00Z', res_model: 'account.move', res_id: 88, fields_written: [], outcome: 'accepted' },
    { id: 3, action: 'company_written', actor: { id: 7, name: 'سارة القحطاني' }, created_at: '2030-01-10T08:00:00Z', res_model: 'res.company', res_id: 1, fields_written: ['vat', 'company_registry'], outcome: null },
  ],
  total: 3,
})
const serve = (body: unknown) => ({ msw: { handlers: { audit: [http.get('/api/v1/me', () => HttpResponse.json(me)), http.get('/api/v1/finance/audit-events', () => HttpResponse.json(body))] } } })

const meta = {
  title: 'Finance/AuditPreview', component: AuditPreview,
  parameters: { layout: 'padded', a11y: { test: 'error' }, ...storyContext('apps/web/app/pages/settings/apps/finance/index.vue:116', 'آخر أحداث تدقيق المالية صفوفًا مدمجة داخل بطاقة المعاينة؛ الفلاتر والترقيم في صفحة السجل الكاملة.') },
  render: () => ({ components: { AuditPreview }, template: '<div class="max-w-lg rounded-card bg-default ring ring-default"><AuditPreview /></div>' }),
} satisfies Meta<typeof AuditPreview>
export default meta
type Story = StoryObj<typeof meta>

export const Latest: Story = { name: 'آخر الأحداث', parameters: serve(events) }
export const Empty: Story = { name: 'فارغة', parameters: serve({ items: [], total: 0 }) }
