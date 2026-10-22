import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ModuleRail from '@webvue/ui/app/components/shell/ModuleRail.vue'
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
  parameters: storyContext('apps/web/app/components/shell/AppSidebar.vue:44'),
  render: args => ({ components: { ModuleRail }, setup: () => ({ args }), template: '<div class="webvue-shell"><ModuleRail v-bind="args" /></div>' }),
}

export const SettingsActive: Story = { ...Default, name: 'الإعدادات نشطة', args: { activeId: 'settings' } }

const assistantItem = { id: 'assistant', labelKey: 'nav.ai', shortLabelKey: 'nav.rail.ai', icon: 'i-lucide-sparkles', to: '/ai', utility: true }
const utilityWithAssistant = [assistantItem, ...shellRail.utility]

export const AssistantUtility: Story = { ...Default, name: 'أداة فوق الإعدادات', args: { rail: { ...shellRail, utility: utilityWithAssistant }, activeId: 'assistant' } }

export const LauncherActive: Story = { ...Default, name: 'المشغّل نشط', args: { activeId: 'apps' } }

export const FewPinned: Story = { ...Default, name: 'تطبيق واحد مثبّت', args: { rail: { ...shellRail, pinned: shellRail.pinned.slice(0, 1) }, activeId: 'apps' } }

export const NonePinned: Story = { ...Default, name: 'لا تطبيق مثبّت', args: { rail: { ...shellRail, pinned: [] }, activeId: 'apps' } }
