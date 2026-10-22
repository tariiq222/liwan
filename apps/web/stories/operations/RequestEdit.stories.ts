import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse } from 'msw'
import RequestEdit from '../../app/components/operations/RequestEdit.vue'
import { __getRouter } from '../../.storybook/nuxt-shims'
import { storyContext } from '../support/context'
import { draft, operationHandlers } from './fixtures'
const meta = {
  title: 'Operations/RequestEdit', component: RequestEdit,
  parameters: { layout: 'fullscreen', ...storyContext('apps/web/app/pages/operations/self/[id]/edit.vue:5'), msw: { handlers: { api: [http.get('/api/v1/operations/requests/employee/me/:id', () => HttpResponse.json({ ...draft, purpose: 'employee' })), http.get('/api/v1/operations/requests/:id', () => HttpResponse.json(draft)), ...operationHandlers] } } },
  args: { personal: true },
  loaders: [async context => {
    const router = __getRouter()
    if (!router) return
    if (!router.hasRoute('personal-RequestEdit')) router.addRoute({ name: 'personal-RequestEdit', path: '/account/requests/:id/edit', component: { render: () => null } })
    const workPath = '/operations/12/edit'
    if (!router.hasRoute('work-RequestEdit')) router.addRoute({ name: 'work-RequestEdit', path: workPath.replace('12', ':id'), component: { render: () => null } })
    await router.replace(context.args.personal ? '/account/requests/12/edit' : workPath)
  }],
} satisfies Meta<typeof RequestEdit>
export default meta
type Story = StoryObj<typeof meta>
export const Personal: Story = {}
export const Work: Story = { args: { personal: false } }
