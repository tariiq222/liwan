import type { Meta, StoryObj } from '@storybook/vue3-vite'
import RelationshipWarning from '../../../app/components/hr/payroll/RelationshipWarning.vue'
import { storyContext } from '../../support/context'

// The non-blocking notice shown for a relationship other than employee; for an employee it renders nothing.
const meta = {
  title: 'HR/Payroll/RelationshipWarning',
  component: RelationshipWarning,
  parameters: {
    ...storyContext('apps/web/app/components/hr/payroll/CompensationSection.vue:44', 'تنبيه غير مانع يظهر حين يختار العميل نوع علاقة غير «موظف»: الاحتساب يطبق التأمينات وحماية الأجور ونهاية الخدمة كما هي، ولا يمنع المسير ولا الصرف.'),
  },
  args: { relationship: 'independent_contractor' },
} satisfies Meta<typeof RelationshipWarning>

export default meta
type Story = StoryObj<typeof meta>

export const Contractor: Story = { name: 'متعاقد مستقل' }

export const Employee: Story = { name: 'موظف (لا تنبيه)', args: { relationship: 'employee' } }
