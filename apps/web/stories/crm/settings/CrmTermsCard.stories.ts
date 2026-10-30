import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse } from 'msw'
import CrmTermsCard from '../../../app/components/crm/settings/CrmTermsCard.vue'
import { storyContext } from '../../support/context'
import { me } from '../../fixtures/pmo'
import { crmSettings } from './crmSettingsFixtures'

const manage = http.get('/api/v1/me', () => HttpResponse.json({ ...me, capabilities: ['crm.settings.read', 'crm.settings.manage'] }))
const renamed = {
  ...crmSettings,
  values: { ...crmSettings.values, terms: { ...crmSettings.values.terms, opportunity: { ar: { singular: 'حالة', plural: 'حالات' }, en: { singular: 'case', plural: 'cases' }, gender: 'f' as const } } },
}
const meta = {
  title: 'CRM/CrmTermsCard',
  component: CrmTermsCard,
  parameters: {
    ...storyContext('apps/web/app/pages/settings/apps/crm/index.vue:38', 'تسمية العميل والفرصة والباقة مع معاينة لتوافق الصفة مع الجنس النحوي.'),
    msw: { handlers: { api: [manage, http.patch('/api/v1/crm/settings', async ({ request }) => HttpResponse.json({ ...crmSettings, revision: 4, values: { ...crmSettings.values, ...(await request.json() as { values: object }).values } }))] } },
  },
  args: { settings: crmSettings, canEdit: true, reloadSettings: async () => renamed },
} satisfies Meta<typeof CrmTermsCard>
export default meta
type Story = StoryObj<typeof meta>
export const Defaults: Story = {}
export const Renamed: Story = { args: { settings: renamed } }
export const ReadOnly: Story = { args: { canEdit: false } }
export const Conflict: Story = { parameters: { msw: { handlers: { api: [manage, http.patch('/api/v1/crm/settings', () => HttpResponse.json({ code: 'conflict', message: 'CRM settings changed; reload before saving' }, { status: 409 }))] } } } }
