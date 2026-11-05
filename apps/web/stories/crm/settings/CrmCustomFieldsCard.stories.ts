import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse } from 'msw'
import CrmCustomFieldsCard from '../../../app/components/crm/settings/CrmCustomFieldsCard.vue'
import { storyContext } from '../../support/context'
import { me } from '../../fixtures/pmo'
import { crmSettings } from './crmSettingsFixtures'

const manage = http.get('/api/v1/me', () => HttpResponse.json({ ...me, capabilities: ['crm.settings.read', 'crm.settings.manage'] }))
const meta = {
  title: 'CRM/CrmCustomFieldsCard',
  component: CrmCustomFieldsCard,
  parameters: {
    ...storyContext('apps/web/app/pages/settings/apps/crm/index.vue:40', 'حقول الفرص المخصصة للشركة: تعريف واحد يمتد إلى كل فرصة، والموظفون يملؤون قيمه.'),
    msw: { handlers: { api: [manage, http.patch('/api/v1/crm/settings', async ({ request }) => HttpResponse.json({ ...crmSettings, revision: 4, values: { ...crmSettings.values, ...(await request.json() as { values: object }).values } }))] } },
  },
  args: { settings: crmSettings, canEdit: true, reloadSettings: async () => crmSettings },
} satisfies Meta<typeof CrmCustomFieldsCard>
export default meta
type Story = StoryObj<typeof meta>

export const Defaults: Story = {}
export const ReadOnly: Story = { args: { canEdit: false } }
export const NoFields: Story = { args: { settings: { ...crmSettings, values: { ...crmSettings.values, lead_properties: [] } } } }
export const Conflict: Story = {
  parameters: { msw: { handlers: { api: [manage, http.patch('/api/v1/crm/settings', () => HttpResponse.json({ code: 'conflict', message: 'CRM settings changed; reload before saving' }, { status: 409 }))] } } },
}
