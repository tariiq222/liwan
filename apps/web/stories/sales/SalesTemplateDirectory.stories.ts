import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse } from 'msw'
import SalesTemplateDirectory from '../../app/components/sales/SalesTemplateDirectory.vue'
import { __getRouter } from '../../.storybook/nuxt-shims'
import { storyContext } from '../support/context'
import { meWith } from './salesFixtures'
import { templateItems } from './salesTemplateFixtures'

const manager = http.get('/api/v1/me', () => HttpResponse.json(meWith(['sales.settings.manage'])))
const rows = http.get('/api/v1/sales/templates', () => HttpResponse.json({ items: templateItems, total: templateItems.length }))
const empty = http.get('/api/v1/sales/templates', () => HttpResponse.json({ items: [], total: 0 }))
const at = (path: string) => async () => { await __getRouter()!.replace(path); return {} }

const meta = {
  title: 'Sales/SalesTemplateDirectory',
  component: SalesTemplateDirectory,
  parameters: { layout: 'padded', ...storyContext('apps/web/app/pages/settings/apps/sales/templates/index.vue:19', 'قائمة قوالب عروض الأسعار: البحث والمؤرشفة، وعلامة على القالب الذي يحتاج مراجعة.'), msw: { handlers: { api: [manager, rows] } } },
} satisfies Meta<typeof SalesTemplateDirectory>
export default meta
type Story = StoryObj<typeof meta>

export const Rows: Story = { name: 'قوالب', loaders: [at('/settings/apps/sales/templates')] }
export const Empty: Story = { name: 'لا قوالب', loaders: [at('/settings/apps/sales/templates')], parameters: { msw: { handlers: { api: [manager, empty] } } } }
export const NoResults: Story = { name: 'لا نتائج للبحث', loaders: [at('/settings/apps/sales/templates?q=x')], parameters: { msw: { handlers: { api: [manager, empty] } } } }
export const Failed: Story = { name: 'فشل التحميل', loaders: [at('/settings/apps/sales/templates')], parameters: { msw: { handlers: { api: [manager, http.get('/api/v1/sales/templates', () => HttpResponse.json({ code: 'unavailable', message: 'down' }, { status: 503 }))] } } } }
export const Forbidden: Story = { name: 'بلا صلاحية', parameters: { msw: { handlers: { api: [http.get('/api/v1/me', () => HttpResponse.json(meWith(['sales.read'])))] } } } }
