import type { Meta, StoryObj } from '@storybook/vue3-vite'
import SaduDivider from '@liwan/ui/app/components/shared/layout/SaduDivider.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/SaduDivider',
  component: SaduDivider,
  parameters: { a11y: { test: 'error' }, ...storyContext('apps/web/app/components/pmo/projects/ProjectGeneralForm.vue:191', 'فاصل زخرفي: خط رفيع بلون الرمل في وسطه نقطة سدو.') },
  render: () => ({ components: { SaduDivider }, template: '<div style="width: 100%; max-width: 480px"><SaduDivider /></div>' }),
} satisfies Meta<typeof SaduDivider>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { name: 'خط ومعين' }
