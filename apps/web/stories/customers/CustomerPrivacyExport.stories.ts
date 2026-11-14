import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { fn } from 'storybook/test'
import CustomerPrivacyExport from '../../app/components/customers/CustomerPrivacyExport.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Customers/CustomerPrivacyExport',
  component: CustomerPrivacyExport,
  parameters: {
    layout: 'padded',
    ...storyContext('apps/web/app/pages/customers/[id]/privacy.vue:96', 'تصدير البيانات الشخصية لعميل واحد: يُسأل عن السبب أولًا ويُحفظ في سجل الخصوصية، ثم ينزل الملف. السبب المرفوض أو فشل التنزيل يظهران تحت الحقل دون مغادرة الصفحة.'),
  },
  args: { onSubmit: fn() },
} satisfies Meta<typeof CustomerPrivacyExport>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { name: 'الحالة العادية' }
export const Exporting: Story = { name: 'جارٍ التصدير', args: { pending: true } }
export const Failed: Story = { name: 'فشل التصدير', args: { failed: true } }
export const ReasonRefused: Story = { name: 'السبب مرفوض', args: { reasonRefused: true } }
