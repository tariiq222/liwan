import type { Meta, StoryObj } from '@storybook/vue3-vite'
import LauncherCard from '../../app/components/launcher/LauncherCard.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Launcher/LauncherCard',
  component: LauncherCard,
  parameters: { layout: 'padded', a11y: { test: 'error' }, ...storyContext('apps/web/app/pages/apps/index.vue:39') },
  args: {
    entry: { id: 'finance', labelKey: 'nav.finance', icon: 'i-lucide-landmark', to: '/finance', overviewTo: '/apps/finance', pinnable: true, pinned: false, pinIndex: null },
    description: 'الحسابات والفواتير والتقارير المالية للشركة.',
    pinnedCount: 3,
  },
  render: args => ({ components: { LauncherCard }, setup: () => ({ args }), template: '<div class="max-w-sm"><LauncherCard v-bind="args" /></div>' }),
} satisfies Meta<typeof LauncherCard>
export default meta
type Story = StoryObj<typeof meta>

export const Unpinned: Story = { name: 'غير مثبّت' }

export const Pinned: Story = { name: 'مثبّت مع الترتيب', args: { entry: { ...meta.args.entry, pinned: true, pinIndex: 1 } } }

export const AlwaysInRail: Story = { name: 'دائم في الشريط', args: { entry: { ...meta.args.entry, id: 'ai', labelKey: 'nav.ai', icon: 'i-lucide-sparkles', to: '/ai', overviewTo: '/apps/ai', pinnable: false } } }
