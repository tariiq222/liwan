import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ShellBreadcrumb from '../../app/components/shell/ShellBreadcrumb.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shell/ShellBreadcrumb',
  component: ShellBreadcrumb,
  args: { items: [{ label: 'المشاريع', to: '/projects' }, { label: 'مشروع البوابة', to: '/projects/1' }, { label: 'المهام' }] },
} satisfies Meta<typeof ShellBreadcrumb>
export default meta
type Story = StoryObj<typeof meta>

export const Trail: Story = { name: 'ثلاثة مستويات', parameters: storyContext('apps/web/app/components/shell/ShellHeader.vue:84') }
export const Single: Story = { name: 'مستوى واحد', parameters: storyContext('apps/web/app/components/shell/ShellHeader.vue:84'), args: { items: [{ label: 'الإعدادات' }] } }
