import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ShellNavSection from '@liwan/ui/app/components/shell/ShellNavSection.vue'
import { appLinkRows, pinnedRows } from '../fixtures/shell'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shell/ShellNavSection',
  component: ShellNavSection,
  args: { label: 'تطبيقاتي', title: 'تطبيقاتي', items: pinnedRows, hydrated: true },
  render: args => ({ components: { ShellNavSection }, setup: () => ({ args }), template: '<div class="liwan-shell" style="width: 264px; padding: 14px"><ShellNavSection v-bind="args" /></div>' }),
} satisfies Meta<typeof ShellNavSection>
export default meta
type Story = StoryObj<typeof meta>

const context = storyContext('apps/web/app/components/shell/AppSidebar.vue:65')

export const Applications: Story = { name: 'تطبيقات بشارة العدد', parameters: context, args: { action: { label: 'تعديل', to: '/apps' } } }
export const Branches: Story = { name: 'فرع مفتوح فيه الصفحة الحالية', parameters: context, args: { label: 'المشاريع', title: 'المشاريع', items: appLinkRows.map(row => row.id === 'planning' ? { ...row, children: row.children!.map(child => child.id === 'planning-mine' ? { ...child, active: true } : child) } : { ...row, active: false }) } }
export const NoTitle: Story = { name: 'بلا عنوان', parameters: context, args: { title: undefined } }
