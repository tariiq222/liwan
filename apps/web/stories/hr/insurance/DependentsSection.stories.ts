import type { Meta, StoryObj } from '@storybook/vue3-vite'
import DependentsSection from '../../../app/components/hr/insurance/DependentsSection.vue'
import { storyContext } from '../../support/context'
import { dependentFixture } from './fixtures'

// The dependents of one enrollment on its record page: add, edit and end happen inline.
const meta = {
  title: 'HR/Insurance/DependentsSection',
  component: DependentsSection,
  parameters: storyContext('apps/web/app/pages/hr/insurance/enrollments/[enrollmentId].vue:138', 'قسم التابعين في صفحة التسجيل: إضافة وتعديل وإنهاء تغطية داخل الصفحة، ورقم الهوية مقنّع حتى يفتح المدير صف التعديل.'),
  args: {
    enrollmentId: 5,
    dependents: [dependentFixture(), dependentFixture({ id: 10, name: 'نورة الحربي', relation: 'spouse', state: 'ended', date_to: '2026-05-31' })],
    canEdit: true,
    requireId: false,
    from: '2026-02-01',
    to: '2026-12-31',
  },
} satisfies Meta<typeof DependentsSection>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { name: 'تابعون' }
export const Empty: Story = { name: 'بلا تابعين', args: { dependents: [] } }
export const ReadOnly: Story = { name: 'للقراءة فقط', args: { canEdit: false } }
export const IdRequired: Story = { name: 'رقم الهوية مطلوب', args: { requireId: true } }
