import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse } from 'msw'
import PendingCharterReviews from '../../../app/components/pmo/projects/dashboard/PendingCharterReviews.vue'
import PageContainer from '@nasq/ui/app/components/shared/layout/PageContainer.vue'
import { project } from '../../fixtures/pmo'
import { storyContext } from '../../support/context'

const waiting = [
  { ...project, id: 1, name: 'مشروع ألفا', charter_state: 'submitted' },
  { ...project, id: 2, name: 'تطوير البوابة', charter_state: 'submitted' },
]
const list = (items: unknown[]) => [http.get('/api/v1/projects', () => HttpResponse.json({ items, total: items.length, can_create: true, can_list_archived: true }))]

const meta = {
  title: 'Project/PendingCharterReviews',
  component: PendingCharterReviews,
  parameters: { layout: 'fullscreen', ...storyContext('apps/web/app/pages/projects/dashboard.vue:165') },
  render: () => ({
    components: { PageContainer, PendingCharterReviews },
    template: '<main class="nasq-shell-main"><PageContainer width="list"><PendingCharterReviews /></PageContainer></main>',
  }),
} satisfies Meta<typeof PendingCharterReviews>
export default meta
type Story = StoryObj<typeof meta>

export const Waiting: Story = { name: 'مواثيق بانتظار الاعتماد', parameters: { msw: { handlers: { api: list(waiting) } } } }
export const Empty: Story = { name: 'لا شيء بانتظار الاعتماد (لا يظهر شيء)', parameters: { msw: { handlers: { api: list([]) } } } }
export const LoadFailed: Story = {
  name: 'فشل التحميل',
  parameters: { msw: { handlers: { api: [http.get('/api/v1/projects', () => HttpResponse.json({ code: 'error', message: 'x' }, { status: 500 }))] } } },
}
