import type { Meta, StoryObj } from '@storybook/vue3-vite'
import RouteTabs from '@liwan/ui/app/components/shared/layout/RouteTabs.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/RouteTabs',
  component: RouteTabs,
  parameters: { layout: 'padded', a11y: { test: 'error' }, ...storyContext('apps/web/app/components/pmo/projects/workspace/ProjectWorkspaceTabs.vue:45') },
  args: {
    ariaLabel: 'أقسام المشروع',
    items: [
      { key: 'project-tab-overview', label: 'نظرة عامة', to: '/projects/1', active: false, icon: 'i-lucide-layout-dashboard' },
      { key: 'project-tab-tasks', label: 'المهام', to: '/projects/1/tasks', active: true, icon: 'i-lucide-list-checks' },
      { key: 'project-tab-schedule', label: 'الجدول الزمني', to: '/projects/1/schedule', active: false, icon: 'i-lucide-calendar-range' },
      { key: 'project-tab-governance', label: 'الحوكمة', to: '/projects/1/governance', active: false, icon: 'i-lucide-shield-check' },
      { key: 'project-tab-finance', label: 'المالية', to: '/projects/1/finance', active: false, icon: 'i-lucide-wallet' },
    ],
  },
} satisfies Meta<typeof RouteTabs>
export default meta
type Story = StoryObj<typeof meta>

export const Workspace: Story = { name: 'أقسام المشروع' }
export const WithCounts: Story = {
  name: 'تبويبات بأعداد (خط 2.5px بلون التطبيق)',
  args: {
    ariaLabel: 'محادثات البريد',
    items: [
      { key: 'inbox-tab-all', label: 'كل المحادثات', to: '/inbox', active: true, count: 12 },
      { key: 'inbox-tab-mine', label: 'محادثاتي', to: '/inbox?scope=mine', active: false, count: 4 },
      { key: 'inbox-tab-unassigned', label: 'غير مسندة', to: '/inbox?scope=unassigned', active: false, count: 3 },
    ],
  },
  render: args => ({
    components: { RouteTabs },
    setup: () => ({ args }),
    template: '<div data-app="inbox"><RouteTabs v-bind="args" /></div>',
  }),
}
export const Pill: Story = { name: 'شريط حبّات (مساحة المشروع)', args: { variant: 'pill' } }

export const NarrowScrolls: Story = {
  name: 'شريط ضيق: سطر واحد يمرَّر مع تلاشي الحافة والتبويب الحالي في الوسط',
  args: {
    items: [
      { key: 'tab-summary', label: 'الملخص', to: '/projects/1', active: false },
      { key: 'tab-tasks', label: 'المهام', to: '/projects/1/tasks', active: false },
      { key: 'tab-updates', label: 'التحديثات', to: '/projects/1/updates', active: false },
      { key: 'tab-planning', label: 'التخطيط', to: '/projects/1/schedule', active: false },
      { key: 'tab-governance', label: 'الحوكمة', to: '/projects/1/charter', active: false },
      { key: 'tab-finance', label: 'المالية', to: '/projects/1/finance', active: false },
      { key: 'tab-meetings', label: 'الاجتماعات', to: '/projects/1/meetings', active: true },
    ],
  },
  render: args => ({
    components: { RouteTabs },
    setup: () => ({ args }),
    template: '<div class="w-72"><RouteTabs v-bind="args" /></div>',
  }),
}
export const WithSeparator: Story = {
  name: 'فاصل قبل تبويبات السجل',
  args: {
    ariaLabel: 'أقسام الاجتماع',
    items: [
      { key: 'meeting-tab-summary', label: 'الملخص', to: '/meetings/1', active: true },
      { key: 'meeting-tab-minutes', label: 'المحضر', to: '/meetings/1?tab=minutes', active: false },
      { key: 'meeting-tab-history', label: 'السجل', to: '/meetings/1?tab=history', active: false, separatorBefore: true },
    ],
  },
}
