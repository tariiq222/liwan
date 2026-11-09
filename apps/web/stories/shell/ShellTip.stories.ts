import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ShellTip from '@liwan/ui/app/components/shell/ShellTip.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shell/ShellTip',
  component: ShellTip,
  parameters: {
    a11y: { test: 'error' },
    ...storyContext('packages/ui/app/components/shell/ShellCoreApps.vue:22', 'تلميح اسم التطبيق في صف الأيقونات؛ الزر يحتفظ باسمه المتاح عند غياب التلميح.'),
  },
  args: { label: 'المشاريع', always: true },
  render: args => ({
    components: { ShellTip },
    setup: () => ({ args }),
    template: '<ShellTip v-bind="args"><UButton icon="i-lucide-folders" square :aria-label="args.label" /></ShellTip>',
  }),
} satisfies Meta<typeof ShellTip>

export default meta
type Story = StoryObj<typeof meta>
export const CoreApp: Story = { name: 'اسم أيقونة التطبيق' }
