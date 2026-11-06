import type { Meta, StoryObj } from '@storybook/vue3-vite'
import SaduLoader from '@liwan/ui/app/components/shared/feedback/SaduLoader.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/SaduLoader',
  component: SaduLoader,
  parameters: { a11y: { test: 'error' }, ...storyContext('packages/ui/app/components/shared/data/ChartPanel.vue:47', 'لودر السدو للأماكن الصغيرة: مثلثات الشعار تضيء بالتناوب، أو نقاط السدو بجانب النص. الصفحات والقوائم تبقى على LoadingSkeleton.') },
  args: { variant: 'mark' },
} satisfies Meta<typeof SaduLoader>
export default meta
type Story = StoryObj<typeof meta>

export const Mark: Story = { name: 'العلامة (قسم صغير)' }
export const Dots: Story = { name: 'النقاط (بجانب النص)', args: { variant: 'dots' } }
