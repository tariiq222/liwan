import type { Meta, StoryObj } from '@storybook/vue3-vite'
import EnrollmentTable from '../../../app/components/hr/insurance/EnrollmentTable.vue'
import ListCard from '@liwan/ui/app/components/shared/layout/ListCard.vue'
import PageContainer from '@liwan/ui/app/components/shared/layout/PageContainer.vue'
import { storyContext } from '../../support/context'
import { enrollmentFixture } from './fixtures'

// The enrollment table of /hr/insurance: one row per membership with plan, coverage dates, dependents and state pill,
// inside the page's SharedListCard. Static fixtures, no requests.
const meta = {
  title: 'HR/Insurance/EnrollmentTable',
  component: EnrollmentTable,
  parameters: {
    layout: 'fullscreen',
    ...storyContext('apps/web/app/pages/hr/insurance.vue:176', 'جدول تسجيلات التأمين داخل بطاقة القائمة: الموظف والخطة ومزوّدها والتغطية وعدد التابعين وحالة التسجيل.'),
  },
  args: {
    enrollments: [
      enrollmentFixture(),
      enrollmentFixture({ id: 6, employee: { id: 8, name: 'سارة القحطاني' }, dependents_count: 0, date_to: '2026-06-30', date_end: '2026-06-30', state: 'ended' }),
      enrollmentFixture({ id: 7, employee: { id: 9, name: 'خالد العتيبي' }, state: 'cancelled', dependents_count: 0 }),
    ],
    rowTo: () => '/hr/insurance/enrollments/5',
    caption: 'التسجيلات',
  },
  render: args => ({
    components: { EnrollmentTable, ListCard, PageContainer },
    setup: () => ({ args }),
    template: '<main class="liwan-shell-main"><PageContainer width="list"><ListCard><EnrollmentTable v-bind="args" /></ListCard></PageContainer></main>',
  }),
} satisfies Meta<typeof EnrollmentTable>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { name: 'جدول التسجيلات' }

export const Loading: Story = { name: 'أثناء التحميل', args: { loading: true } }
