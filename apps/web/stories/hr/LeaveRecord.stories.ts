import type { Meta, StoryObj } from '@storybook/vue3-vite'
import LeaveRecord from '../../app/components/hr/LeaveRecord.vue'
import { __getRouter } from '../../.storybook/nuxt-shims'
import { storyContext } from '../support/context'
import { hrSelfServiceHandlers } from './selfServiceFixtures'

const meta = {
  title: 'HR/LeaveRecord', component: LeaveRecord,
  parameters: { layout: 'fullscreen', ...storyContext('apps/web/app/pages/hr/self/leave/[leaveId].vue:6', 'سجل الطلب الشخصي يستخدم واجهة الموظف نفسه ولا يعرض إجراءات الاعتماد، ويعيد استخدام سجل الإجازة الإداري.'), msw: { handlers: { api: hrSelfServiceHandlers } } },
  args: { personal: true },
  loaders: [async context => {
    const router = __getRouter()
    if (!router) return
    if (!router.hasRoute('hr-self-service-story')) router.addRoute({ name: 'hr-self-service-story', path: '/account/leave/:leaveId', component: { render: () => null } })
    if (!router.hasRoute('hr-leave-story')) router.addRoute({ name: 'hr-leave-story', path: '/hr/leave/:leaveId', component: { render: () => null } })
    await router.replace(context.args.personal ? '/account/leave/12' : '/hr/leave/12')
  }],
} satisfies Meta<typeof LeaveRecord>
export default meta
type Story = StoryObj<typeof meta>
export const Personal: Story = { name: 'سجل طلب إجازتي' }
export const Management: Story = { name: 'سجل الاعتماد الإداري', args: { personal: false } }
