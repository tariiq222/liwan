import type { Meta, StoryObj } from '@storybook/vue3-vite'
import RouteTabs from '../../app/components/shared/RouteTabs.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/RouteTabs',
  component: RouteTabs,
  parameters: { layout: 'padded', a11y: { test: 'error' }, ...storyContext('apps/web/app/components/project/workspace/ProjectWorkspaceTabs.vue:41') },
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
