import type { Meta, StoryObj } from '@storybook/vue3-vite'
import PlanTable from '../../../app/components/hr/insurance/PlanTable.vue'
import ListCard from '@liwan/ui/app/components/shared/layout/ListCard.vue'
import PageContainer from '@liwan/ui/app/components/shared/layout/PageContainer.vue'
import { storyContext } from '../../support/context'
import { planFixture } from './fixtures'

// The plan table of /hr/insurance: provider, tier, validity and the days left; a running plan inside the
// company's alert window is flagged. Static fixtures, no requests.
const meta = {
  title: 'HR/Insurance/PlanTable',
  component: PlanTable,
  parameters: {
    layout: 'fullscreen',
    ...storyContext('apps/web/app/pages/hr/insurance.vue:175', 'جدول خطط التأمين داخل بطاقة القائمة: الخطة ومزوّدها وصلاحيتها وحالتها، وتنبيه الخطة القريبة من الانتهاء.'),
  },
  args: {
    plans: [
      planFixture(),
      planFixture({ id: 4, name: 'الباقة الفضية 2026', tier: 'فضية', expires_in_days: 20 }),
      planFixture({ id: 5, name: 'باقة 2025', state: 'expired', expires_in_days: -40, valid_from: '2025-01-01', valid_to: '2025-12-31' }),
      planFixture({ id: 6, name: 'باقة قديمة', state: 'archived', active: false, expires_in_days: null }),
    ],
    rowTo: () => '/hr/insurance/plans/3',
    caption: 'الخطط',
    alertDays: 60,
  },
  render: args => ({
    components: { PlanTable, ListCard, PageContainer },
    setup: () => ({ args }),
    template: '<main class="liwan-shell-main"><PageContainer width="list"><ListCard><PlanTable v-bind="args" /></ListCard></PageContainer></main>',
  }),
} satisfies Meta<typeof PlanTable>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { name: 'جدول الخطط' }

export const Loading: Story = { name: 'أثناء التحميل', args: { loading: true } }
