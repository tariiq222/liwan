import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { ref } from 'vue'
import RoleCheckboxes from '../../app/components/access/users/RoleCheckboxes.vue'
import PageContainer from '@liwan/ui/app/components/shared/layout/PageContainer.vue'
import { storyContext } from '../support/context'

const roles = [
  { id: 1, name: { ar: 'مدير المبيعات', en: 'Sales manager' }, description: ['يدير فريق المبيعات', 'على مستوى الشركة'] },
  { id: 2, name: { ar: 'قارئ المالية', en: 'Finance reader' }, description: ['على مستوى الشركة'] },
  { id: 3, name: { ar: 'دور موقوف', en: 'Disabled role' }, description: ['على مستوى الشركة'], warning: 'الدور موقوف وتبقى الإسنادات القائمة', disabled: true },
]
const meta = {
  title: 'Access/RoleCheckboxes', component: RoleCheckboxes,
  parameters: { layout: 'fullscreen', ...storyContext('apps/web/app/components/access/users/UserAccessForm.vue:117') },
  args: { roles, modelValue: [], legend: 'الأدوار', emptyText: 'لا توجد أدوار متاحة للإسناد.' },
  render: args => ({ components: { RoleCheckboxes, PageContainer }, setup: () => ({ args, selected: ref(args.modelValue) }), template: '<main class="liwan-shell-main"><PageContainer><RoleCheckboxes v-bind="args" v-model="selected" /></PageContainer></main>' }),
} satisfies Meta<typeof RoleCheckboxes>
export default meta
type Story = StoryObj<typeof meta>
export const Several: Story = { name: 'عدة أدوار' }
export const SomeSelected: Story = { name: 'بعضها محدد', args: { modelValue: [1, 3] } }
export const Locked: Story = { name: 'مقفل أثناء الحفظ', args: { modelValue: [2], disabled: true } }
export const Empty: Story = { name: 'لا أدوار متاحة', args: { roles: [] } }
