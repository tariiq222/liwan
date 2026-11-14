import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse } from 'msw'
import IntegrationProvidersCard from '../../app/components/settings/IntegrationProvidersCard.vue'
import { storyContext } from '../support/context'
import { providers } from './integrationFixtures'

const serve = (body: unknown, status = 200) => ({ msw: { handlers: { integrations: [http.get('/api/v1/integrations/providers', () => HttpResponse.json(body, { status }))] } } })

const meta = {
  title: 'Settings/IntegrationProvidersCard', component: IntegrationProvidersCard,
  parameters: { layout: 'padded', a11y: { test: 'error' }, ...storyContext('apps/web/app/pages/settings/integrations.vue:40', 'بطاقة ربط حساب جديد: مزوّد المفاتيح يفتح لوحة الإنشاء، ومزوّد OAuth يفتح صفحة المزوّد. المزوّد الذي يديره تطبيق لا يظهر هنا.') },
  render: () => ({ components: { IntegrationProvidersCard }, template: '<div class="max-w-2xl"><IntegrationProvidersCard /></div>' }),
} satisfies Meta<typeof IntegrationProvidersCard>
export default meta
type Story = StoryObj<typeof meta>

export const Providers: Story = { name: 'مزوّدون', parameters: serve(providers) }
export const Empty: Story = { name: 'فارغة', parameters: serve({ items: [], total: 0 }) }
export const Failed: Story = { name: 'تعذر التحميل', parameters: serve({ code: 'server_error', message: 'تعذر التحميل' }, 500) }
