import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse } from 'msw'
import LeaveList from '../../app/components/hr/LeaveList.vue'
import { __getRouter } from '../../.storybook/nuxt-shims'
import { storyContext } from '../support/context'
import { hrSelfServiceHandlers } from './selfServiceFixtures'

const meta = {
  title: 'HR/LeaveList',
  component: LeaveList,
  parameters: { layout: 'fullscreen', ...storyContext('apps/web/app/pages/hr/self/leave.vue:9', 'قائمة الإجازات المشتركة؛ الخدمة الذاتية تعرض الطلبات والرصيد للموظف نفسه، والإدارة تعرض قائمة انتظار بلا رصيد شخصي.'), msw: { handlers: { api: hrSelfServiceHandlers } } },
  args: { personal: true },
  loaders: [async context => { await __getRouter()?.replace(context.args.personal ? '/account/leave?scope=all' : '/hr/leave') }],
} satisfies Meta<typeof LeaveList>
export default meta
type Story = StoryObj<typeof meta>
export const Personal: Story = { name: 'طلباتي حتى لمدير الموارد البشرية' }
export const Management: Story = { name: 'قائمة الاعتماد الإدارية', args: { personal: false } }
export const NoEmployee: Story = {
  name: 'حساب بلا ملف موظف',
  parameters: { msw: { handlers: { api: [http.get('/api/v1/hr/me', () => HttpResponse.json(null)), ...hrSelfServiceHandlers] } } },
}
export const Empty: Story = {
  name: 'لا توجد طلبات',
  parameters: { msw: { handlers: { api: [http.get('/api/v1/hr/leave/requests', () => HttpResponse.json({ items: [], total: 0 })), ...hrSelfServiceHandlers] } } },
}
export const Error: Story = {
  name: 'تعذر تحميل الطلبات',
  parameters: { msw: { handlers: { api: [http.get('/api/v1/hr/leave/requests', () => HttpResponse.json({ code: 'unavailable', message: 'تعذر تحميل الطلبات' }, { status: 503 })), ...hrSelfServiceHandlers] } } },
}
