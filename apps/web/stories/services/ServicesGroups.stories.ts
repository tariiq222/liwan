import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ServicesGroups from '../../app/components/services/ServicesGroups.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Services/ServicesGroups',
  component: ServicesGroups,
  parameters: {
    layout: 'padded',
    a11y: { test: 'error' },
    ...storyContext('apps/web/app/pages/services.vue:13', 'خدمات المستخدم الذاتية، قسم بعنوان لكل تطبيق وبطاقة رابط لكل خدمة. تُخفى الخدمة التي لا يملك صلاحيتها ويُحذف القسم الفارغ.'),
  },
  render: args => ({ components: { ServicesGroups }, setup: () => ({ args }), template: '<div class="mx-auto max-w-3xl"><ServicesGroups v-bind="args" /></div>' }),
} satisfies Meta<typeof ServicesGroups>
export default meta
type Story = StoryObj<typeof meta>

const entry = (id: string, labelKey: string, descriptionKey: string, icon: `i-lucide-${string}`, to: string, capability: string) => ({ id, labelKey, descriptionKey, icon, to, capability })

export const TwoApplications: Story = {
  name: 'تطبيقان',
  args: {
    groups: [
      {
        id: 'hr', labelKey: 'nav.hr', icon: 'i-lucide-users',
        entries: [
          entry('hr-leave-new', 'hr.leave.new', 'hr.services.requestLeaveDesc', 'i-lucide-calendar-plus', '/hr/leave/new', 'hr.leave.request'),
          entry('hr-leave-mine', 'hr.services.myLeave', 'hr.services.myLeaveDesc', 'i-lucide-calendar-days', '/hr/leave?scope=mine', 'hr.leave.read'),
          entry('hr-payslips-mine', 'nav.myPayslips', 'hr.services.myPayslipsDesc', 'i-lucide-receipt', '/hr/payroll/mine', 'hr.employees.read'),
          entry('hr-assets-mine', 'nav.myAssets', 'hr.services.myAssetsDesc', 'i-lucide-package-check', '/hr/assets/mine', 'hr.employees.read'),
        ],
      },
      {
        id: 'operations', labelKey: 'operations.title', icon: 'i-lucide-workflow',
        entries: [
          entry('operations-new', 'operations.newRequest', 'operations.services.newRequestDesc', 'i-lucide-plus', '/operations/new', 'operations.requests.create'),
          entry('operations-mine', 'operations.nav.mine', 'operations.services.mineDesc', 'i-lucide-files', '/operations', 'operations.requests.read'),
        ],
      },
    ],
  },
}

export const OneApplication: Story = {
  name: 'تطبيق واحد',
  args: { groups: [{ id: 'operations', labelKey: 'operations.title', icon: 'i-lucide-workflow', entries: [entry('operations-mine', 'operations.nav.mine', 'operations.services.mineDesc', 'i-lucide-files', '/operations', 'operations.requests.read')] }] },
}
