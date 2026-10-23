import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse } from 'msw'
import RequestCreate from '../../app/components/operations/RequestCreate.vue'
import { __getRouter } from '../../.storybook/nuxt-shims'
import { storyContext } from '../support/context'
import { draft, operationHandlers } from './fixtures'
const meta = {
  title: 'Operations/RequestCreate', component: RequestCreate,
  parameters: { layout: 'fullscreen', ...storyContext('apps/web/app/pages/operations/self/new.vue:5'), msw: { handlers: { api: [http.get('/api/v1/operations/requests/employee/me/:id', () => HttpResponse.json({ ...draft, purpose: 'employee' })), http.get('/api/v1/operations/requests/:id', () => HttpResponse.json(draft)), ...operationHandlers] } } },
  args: { personal: true },
  loaders: [async context => {
    const router = __getRouter()
    if (!router) return
    if (!router.hasRoute('personal-RequestCreate')) router.addRoute({ name: 'personal-RequestCreate', path: '/account/requests/new', component: { render: () => null } })
    const workPath = '/operations/new'
    if (!router.hasRoute('work-RequestCreate')) router.addRoute({ name: 'work-RequestCreate', path: workPath.replace('12', ':id'), component: { render: () => null } })
    await router.replace(context.args.personal ? '/account/requests/new' : workPath)
  }],
} satisfies Meta<typeof RequestCreate>
export default meta
type Story = StoryObj<typeof meta>
export const Personal: Story = {}
export const Work: Story = { args: { personal: false } }
