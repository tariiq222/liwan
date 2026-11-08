import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ShellAppGrid from '@liwan/ui/app/components/shell/ShellAppGrid.vue'
import { switcherApps } from '../fixtures/shell'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shell/ShellAppGrid',
  component: ShellAppGrid,
  parameters: storyContext('apps/web/app/components/shell/AppAppSwitcher.vue:26'),
  args: { apps: switcherApps, label: 'التنقل بين التطبيقات' },
  render: args => ({ components: { ShellAppGrid }, setup: () => ({ args }), template: '<div class="liwan-shell" style="padding: 24px"><div style="display: inline-block; border-radius: 24px; box-shadow: inset 0 0 0 1px var(--ui-border)"><ShellAppGrid v-bind="args" /></div></div>' }),
} satisfies Meta<typeof ShellAppGrid>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { name: 'بلاطات التطبيقات المتاحة' }
export const Few: Story = { name: 'تطبيقان فقط', args: { apps: switcherApps.slice(0, 2) } }
