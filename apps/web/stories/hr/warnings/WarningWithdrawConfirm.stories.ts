import type { Meta, StoryObj } from '@storybook/vue3-vite'
import WarningWithdrawConfirm from '../../../app/components/hr/warnings/WarningWithdrawConfirm.vue'
import { storyContext } from '../../support/context'

// التأكيد الداخلي لسحب إنذار: سبب السحب مطلوب، ولا يرسل طلبًا؛ القيمة تعود عبر `confirm`.
const meta = {
  title: 'HR/Warnings/WarningWithdrawConfirm',
  component: WarningWithdrawConfirm,
  parameters: storyContext('apps/web/app/pages/hr/warnings/[warningId].vue:94', 'تحت شريط الأخطاء وفوق بطاقة هوية الإنذار في صفحة السجل.'),
  args: { pending: false },
} satisfies Meta<typeof WarningWithdrawConfirm>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { name: 'سحب مع سبب مطلوب' }
export const Pending: Story = { name: 'أثناء الإرسال', args: { pending: true } }
