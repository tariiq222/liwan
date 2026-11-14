import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse } from 'msw'
import IntegrationConnectionsCard from '../../app/components/settings/IntegrationConnectionsCard.vue'
import { storyContext } from '../support/context'
import { connections } from './integrationFixtures'

const serve = (body: unknown, status = 200) => ({ msw: { handlers: { integrations: [http.get('/api/v1/integrations/connections', () => HttpResponse.json(body, { status }))] } } })

const meta = {
  title: 'Settings/IntegrationConnectionsCard', component: IntegrationConnectionsCard,
  parameters: { layout: 'padded', a11y: { test: 'error' }, ...storyContext('apps/web/app/pages/settings/integrations.vue:39', 'بطاقة الحسابات المربوطة: كل حساب بحالته والتطبيقات التي تستخدمه.') },
  render: () => ({ components: { IntegrationConnectionsCard }, template: '<div class="max-w-2xl"><IntegrationConnectionsCard /></div>' }),
} satisfies Meta<typeof IntegrationConnectionsCard>
export default meta
type Story = StoryObj<typeof meta>

export const Connections: Story = { name: 'حسابات', parameters: serve(connections) }
export const Empty: Story = { name: 'فارغة', parameters: serve({ items: [], total: 0 }) }
export const Failed: Story = { name: 'تعذر التحميل', parameters: serve({ code: 'server_error', message: 'تعذر التحميل' }, 500) }
