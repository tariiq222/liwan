import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { ProjectStatusSchema, TaskStateSchema } from '@nasq/contracts'
import { useI18n } from 'vue-i18n'
import StatusBadge from '../../app/components/shared/StatusBadge.vue'
import { projectStatusBadge } from '../../app/composables/projectStatus'
import { deadlineLabel, deadlineTone, taskStateBadge } from '../../app/composables/taskState'
import { accessStateBadge } from '../../app/utils/accessStateBadge'
import { hrAccessBadge } from '../../app/utils/hrAccessBadge'
import { subscriptionStateBadge } from '../../app/utils/subscription'
import { lifecycleBadge } from '../../app/utils/vendorCommercial'
import { orderFulfillmentBadge, orderPaymentBadge } from '../../app/utils/vendorSubscriptions'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/StatusBadge',
  component: StatusBadge,
  parameters: { a11y: { test: 'error' } },
  args: { tone: 'info', label: '' },
} satisfies Meta<typeof StatusBadge>
export default meta
type Story = StoryObj<typeof meta>

const row = (template: string, data: () => Record<string, unknown>): Story['render'] => () => ({
  components: { StatusBadge },
  setup: () => ({ t: useI18n().t, ...data() }),
  template: `<div class="flex flex-wrap items-center gap-2" style="max-width: 640px">${template}</div>`,
})

export const ProjectStatus: Story = {
  name: 'حالة المشروع',
  parameters: storyContext('apps/web/app/components/pmo/projects/ProjectTable.vue:66'),
  render: row('<StatusBadge v-for="s in statuses" :key="String(s)" :tone="projectStatusBadge(s).tone" :label="t(projectStatusBadge(s).labelKey)" />', () => ({ statuses: [...ProjectStatusSchema.options, null], projectStatusBadge })),
}
export const TaskState: Story = {
  name: 'حالة المهمة',
  parameters: storyContext('apps/web/app/components/pmo/tasks/StateMenu.vue:36'),
  render: row('<StatusBadge v-for="s in states" :key="s" :tone="taskStateBadge(s).tone" :label="t(taskStateBadge(s).labelKey)" />', () => ({ states: TaskStateSchema.options, taskStateBadge })),
}
export const Deadline: Story = {
  name: 'موعد المهمة',
  parameters: storyContext('apps/web/app/components/pmo/tasks/TaskCard.vue:101'),
  render: row('<StatusBadge v-for="(c, i) in cases" :key="i" :tone="deadlineTone(c[0], c[1])" :label="deadlineLabel(c[0], t)" />', () => ({ cases: [[-3, false], [0, false], [1, false], [10, false], [-3, true], [null, false]], deadlineTone, deadlineLabel })),
}
export const AccessState: Story = {
  name: 'حالة الوصول',
  parameters: storyContext('apps/web/app/components/access/users/UserTable.vue:54'),
  render: row('<StatusBadge v-for="(r, i) in rows" :key="i" :tone="accessStateBadge(r).tone" :label="t(accessStateBadge(r).labelKey)" />', () => ({ rows: [{ active: true }, { active: false }, { active: true, protected: true }, { active: true, readOnly: true }], accessStateBadge })),
}
export const HrAccess: Story = {
  name: 'حساب الموظف',
  parameters: storyContext('apps/web/app/components/hr/DirectoryTable.vue:213'),
  render: row('<StatusBadge v-for="(a, i) in accesses" :key="i" variant="outline" :tone="hrAccessBadge(a).tone" :label="t(hrAccessBadge(a).labelKey)" />', () => ({
    accesses: [null, { user_id: 7, login: 'sara', role: 'employee', active: true }, { user_id: 2, login: 'admin', role: 'admin', active: true }, { user_id: 9, login: 'm', role: 'employee', active: false }],
    hrAccessBadge,
  })),
}
export const SubscriptionState: Story = {
  name: 'حالة الاشتراك',
  parameters: storyContext('apps/web/app/pages/subscription/index.vue:37'),
  render: row('<StatusBadge v-for="s in states" :key="s" :tone="subscriptionStateBadge(s).tone" :label="t(subscriptionStateBadge(s).labelKey)" />', () => ({ states: ['awaiting_payment', 'activating', 'active', 'failed', 'inactive'], subscriptionStateBadge })),
}
export const Lifecycle: Story = {
  name: 'دورة حياة الحزمة',
  parameters: storyContext('apps/web/app/pages/vendor/bundles/index.vue:50'),
  render: row('<StatusBadge v-for="(v, i) in views" :key="i" :tone="lifecycleBadge(v).tone" :label="t(lifecycleBadge(v).labelKey)" />', () => ({ views: [{ status: 'draft' }, { status: 'validated' }, { status: 'published', available: true }, { status: 'published', available: false }], lifecycleBadge })),
}
export const OrderState: Story = {
  name: 'حالة الطلب',
  parameters: storyContext('apps/web/app/components/vendor/SubscriptionSummary.vue:29'),
  render: row('<template v-for="(o, i) in orders" :key="i"><StatusBadge :tone="orderPaymentBadge(o).tone" :label="t(orderPaymentBadge(o).labelKey)" /><StatusBadge variant="outline" :tone="orderFulfillmentBadge(o).tone" :label="t(orderFulfillmentBadge(o).labelKey)" /></template>', () => ({
    orders: [{ payment_state: 'awaiting_payment', fulfillment_state: 'not_started' }, { payment_state: 'paid', fulfillment_state: 'applied' }, { payment_state: 'paid', fulfillment_state: 'needs_intervention' }],
    orderPaymentBadge, orderFulfillmentBadge,
  })),
}
