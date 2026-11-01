import type { Meta, StoryObj } from '@storybook/vue3-vite'
import WarningTable from '../../../app/components/hr/warnings/WarningTable.vue'
import ListCard from '@liwan/ui/app/components/shared/layout/ListCard.vue'
import PageContainer from '@liwan/ui/app/components/shared/layout/PageContainer.vue'
import { storyContext } from '../../support/context'
import { warningFixture } from './fixtures'

// The warning table of /hr/warnings: one row per warning with employee, type, date and state pill,
// inside the page's SharedListCard. Static fixtures, no requests.
const meta = {
  title: 'HR/Warnings/WarningTable',
  component: WarningTable,
  parameters: {
    layout: 'fullscreen',
    ...storyContext('apps/web/app/pages/hr/warnings.vue:148', 'جدول الإنذارات داخل بطاقة القائمة: الموظف والنوع ومستواه وتاريخ الإصدار وحالة الإنذار.'),
  },
  args: {
    warnings: [
      warningFixture(),
      warningFixture({ id: 6, employee: { id: 8, name: 'سارة القحطاني' }, type: { id: 1, name: 'إنذار شفهي', severity: 1 }, state: 'acknowledged', ack_pending: false }),
      warningFixture({ id: 7, state: 'contested', ack_pending: false }),
      warningFixture({ id: 8, state: 'draft', ack_pending: false, issued_at: null, issued_by: null }),
      warningFixture({ id: 9, state: 'withdrawn', ack_pending: false }),
    ],
    rowTo: () => '/hr/warnings/5',
    caption: 'الإنذارات الإدارية',
  },
  render: args => ({
    components: { WarningTable, ListCard, PageContainer },
    setup: () => ({ args }),
    template: '<main class="liwan-shell-main"><PageContainer width="list"><ListCard><WarningTable v-bind="args" /></ListCard></PageContainer></main>',
  }),
} satisfies Meta<typeof WarningTable>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { name: 'جدول الإنذارات' }

export const Loading: Story = { name: 'أثناء التحميل', args: { loading: true } }
