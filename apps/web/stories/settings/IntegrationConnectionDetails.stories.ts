import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse } from 'msw'
import IntegrationConnectionDetails from '../../app/components/settings/IntegrationConnectionDetails.vue'
import { storyContext } from '../support/context'
import { meta as metaConnection, providers, tiktok } from './integrationFixtures'

const base = '/api/v1/integrations/connections/1'
const handlers = (...extra: ReturnType<typeof http.get>[]) => ({
  msw: { handlers: { integrations: [
    http.post(`${base}/test`, () => HttpResponse.json(metaConnection)),
    http.patch(base, () => HttpResponse.json(metaConnection)),
    http.post(`${base}/secrets/verify_token/rotate`, () => HttpResponse.json({ name: 'verify_token', value: 'vt_9f3a21c8d7e44b05' })),
    http.delete(base, () => HttpResponse.json({ code: 'in_use', message: 'يستخدمه: رسائل العملاء: واتساب' }, { status: 409 })),
    ...extra,
  ] } },
})

const meta = {
  title: 'Settings/IntegrationConnectionDetails', component: IntegrationConnectionDetails,
  parameters: { layout: 'padded', a11y: { test: 'error' }, ...storyContext('apps/web/app/pages/settings/integrations/connections/[id].vue:50', 'صفحة الحساب: الحالة وإجراءاتها، البيانات، المفاتيح بوصفها حضورًا فقط مع استبدال وتدوير، وعناوين الاستقبال.') },
  args: { connection: metaConnection, provider: providers.items[0], canManage: true },
  render: args => ({ components: { IntegrationConnectionDetails }, setup: () => ({ args }), template: '<div class="max-w-2xl"><IntegrationConnectionDetails v-bind="args" /></div>' }),
} satisfies Meta<typeof IntegrationConnectionDetails>
export default meta
type Story = StoryObj<typeof meta>

export const Connected: Story = { name: 'متصل', parameters: handlers() }
export const OAuthError: Story = { name: 'ربط OAuth فيه مشكلة', args: { connection: tiktok, provider: providers.items[1] }, parameters: handlers() }
export const Disabled: Story = { name: 'متوقف', args: { connection: { ...metaConnection, state: 'disabled' } }, parameters: handlers() }
export const ReadOnly: Story = { name: 'عرض فقط', args: { canManage: false }, parameters: handlers() }
