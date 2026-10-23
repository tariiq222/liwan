import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse } from 'msw'
import RequestRecord from '../../app/components/operations/RequestRecord.vue'
import { __getRouter } from '../../.storybook/nuxt-shims'
import { storyContext } from '../support/context'
import { draft, operationHandlers } from './fixtures'
const meta = {
  title: 'Operations/RequestRecord', component: RequestRecord,
  parameters: { layout: 'fullscreen', ...storyContext('apps/web/app/pages/operations/self/[id]/index.vue:5'), msw: { handlers: { api: [http.get('/api/v1/operations/requests/employee/me/:id', () => HttpResponse.json({ ...draft, purpose: 'employee' })), http.get('/api/v1/operations/requests/:id', () => HttpResponse.json(draft)), ...operationHandlers] } } },
  args: { personal: true },
  loaders: [async context => {
    const router = __getRouter()
    if (!router) return
    if (!router.hasRoute('personal-RequestRecord')) router.addRoute({ name: 'personal-RequestRecord', path: '/account/requests/:id', component: { render: () => null } })
    const workPath = '/operations/12'
    if (!router.hasRoute('work-RequestRecord')) router.addRoute({ name: 'work-RequestRecord', path: workPath.replace('12', ':id'), component: { render: () => null } })
    await router.replace(context.args.personal ? '/account/requests/12' : workPath)
  }],
} satisfies Meta<typeof RequestRecord>
export default meta
type Story = StoryObj<typeof meta>
export const Personal: Story = {}
export const Work: Story = { args: { personal: false } }
