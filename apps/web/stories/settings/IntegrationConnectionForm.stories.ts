import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse } from 'msw'
import IntegrationConnectionForm from '../../app/components/settings/IntegrationConnectionForm.vue'
import { storyContext } from '../support/context'
import { meta as metaConnection, providers } from './integrationFixtures'

const metaProvider = providers.items[0]!
const serve = (status: number, body: unknown) => ({ msw: { handlers: { integrations: [http.post('/api/v1/integrations/connections', () => HttpResponse.json(body, { status }))] } } })

const meta = {
  title: 'Settings/IntegrationConnectionForm', component: IntegrationConnectionForm,
  parameters: { layout: 'padded', a11y: { test: 'error' }, ...storyContext('apps/web/app/pages/settings/integrations/new.vue:28', 'نموذج لوحة الربط: معرّف الحساب واسم اختياري وحقول المزوّد ومفاتيح لا تُعرض بعد الحفظ.') },
  args: { provider: metaProvider, backTo: '/settings/integrations' },
  render: args => ({ components: { IntegrationConnectionForm }, setup: () => ({ args }), template: '<div class="max-w-xl"><IntegrationConnectionForm v-bind="args" /></div>' }),
} satisfies Meta<typeof IntegrationConnectionForm>
export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = { name: 'فارغ', parameters: serve(201, metaConnection) }
export const TwilioEmpty: Story = { name: 'Twilio فارغ', args: { provider: providers.items[3]! }, parameters: serve(201, metaConnection) }
export const KeysRefused: Story = { name: 'رفض المزوّد المفاتيح', parameters: serve(422, { code: 'integration_rejected', message: 'رفض المزوّد المفاتيح.' }) }
export const FieldRefused: Story = { name: 'حقل غير صحيح', parameters: serve(422, { code: 'invalid', message: 'معرّف الحساب غير صحيح.', field: 'external_id' }) }
