import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ModuleRail from '@liwan/ui/app/components/shell/ModuleRail.vue'
import { shellRail } from '../fixtures/shell'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shell/ModuleRail',
  component: ModuleRail,
  parameters: { layout: 'fullscreen' },
  args: { rail: shellRail, activeId: 'projects', homeTo: '/' },
} satisfies Meta<typeof ModuleRail>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  name: 'المشاريع نشطة',
  parameters: storyContext('apps/web/app/components/shell/AppSidebar.vue:25'),
  render: args => ({ components: { ModuleRail }, setup: () => ({ args }), template: '<div class="liwan-shell"><ModuleRail v-bind="args" /></div>' }),
}

export const SettingsActive: Story = { ...Default, name: 'الإعدادات نشطة', args: { activeId: 'settings' } }

export const AssistantActive: Story = { ...Default, name: 'Liwan AI نشط', args: { activeId: 'ai' } }

export const LauncherActive: Story = { ...Default, name: 'المشغّل نشط', args: { activeId: 'apps' } }

export const FewApplications: Story = { ...Default, name: 'تطبيق واحد', args: { rail: { ...shellRail, applications: shellRail.applications.slice(0, 1) }, activeId: 'apps' } }
export const NoApplications: Story = { ...Default, name: 'بلا تطبيقات متاحة', args: { rail: { ...shellRail, applications: [] }, activeId: 'apps' } }
export const Overflow: Story = { ...Default, name: 'تطبيقات كثيرة مع تمويه التمرير', args: { rail: { ...shellRail, applications: Array.from({ length: 16 }, (_, index) => ({ ...shellRail.applications[index % shellRail.applications.length]!, id: `app-${index}` })) }, activeId: 'apps' } }
