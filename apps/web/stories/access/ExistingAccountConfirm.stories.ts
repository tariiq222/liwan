import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ExistingAccountConfirm from '../../app/components/access/users/ExistingAccountConfirm.vue'
import PageContainer from '@liwan/ui/app/components/shared/layout/PageContainer.vue'
import { storyContext } from '../support/context'

// The same step serves the invitation dialog and the «give an account» dialog (users/new, with ?employee_id=).
const meta = {
  title: 'Access/ExistingAccountConfirm', component: ExistingAccountConfirm,
  parameters: { layout: 'fullscreen', ...storyContext('apps/web/app/pages/settings/team/users/new.vue:169') },
  args: { name: 'نورة العتيبي', homeCompany: { id: 2, name: 'فرع الرياض' } },
  render: args => ({ components: { ExistingAccountConfirm, PageContainer }, setup: () => ({ args }), template: '<main class="liwan-shell-main"><PageContainer><ExistingAccountConfirm v-bind="args" /></PageContainer></main>' }),
} satisfies Meta<typeof ExistingAccountConfirm>
export default meta
type Story = StoryObj<typeof meta>
export const Confirm: Story = { name: 'تأكيد إضافة حساب موجود' }
export const Pending: Story = { name: 'جارٍ الإضافة', args: { pending: true } }
export const Refused: Story = { name: 'رفض الخادم', args: { error: 'هذا الحساب عضو في هذه الشركة بالفعل.' } }
