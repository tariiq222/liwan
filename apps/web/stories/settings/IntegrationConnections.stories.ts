import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse } from 'msw'
import { IntegrationConnectionListSchema } from '@liwan/contracts'
import IntegrationConnections from '../../app/components/settings/IntegrationConnections.vue'
import { storyContext } from '../support/context'

const connections = IntegrationConnectionListSchema.parse({
  items: [
    { id: 1, kind: 'zatca', provider: 'ZATCA', state: 'pending', last_checked: null, status_message: '' },
    { id: 2, kind: 'bank', provider: 'Al Rajhi', state: 'error', last_checked: '2030-01-15T10:30:00Z', status_message: 'انتهت صلاحية الشهادة' },
    { id: 3, kind: 'bank', provider: 'SNB', state: 'connected', last_checked: '2030-01-15T09:00:00Z', status_message: '' },
  ],
  total: 3,
})
const serve = (body: unknown, status = 200) => ({ msw: { handlers: { integrations: [http.get('/api/v1/integrations/connections', () => HttpResponse.json(body, { status }))] } } })

const meta = {
  title: 'Settings/IntegrationConnections', component: IntegrationConnections,
  parameters: { layout: 'padded', a11y: { test: 'error' }, ...storyContext('apps/web/app/pages/settings/system/index.vue:23', 'بطاقة الربط في صفحة النظام، للقراءة فقط: كل اتصال بحالته وآخر فحص.') },
  render: () => ({ components: { IntegrationConnections }, template: '<div class="max-w-2xl"><IntegrationConnections /></div>' }),
} satisfies Meta<typeof IntegrationConnections>
export default meta
type Story = StoryObj<typeof meta>

export const Connections: Story = { name: 'اتصالات', parameters: serve(connections) }
export const Empty: Story = { name: 'فارغة', parameters: serve({ items: [], total: 0 }) }
export const Failed: Story = { name: 'تعذر التحميل', parameters: serve({ code: 'server_error', message: 'تعذر التحميل' }, 500) }
