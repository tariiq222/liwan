import type { Meta, StoryObj } from '@storybook/vue3-vite'
import type { TableColumn } from '@nuxt/ui'
import { useI18n } from 'vue-i18n'
import type { HrApplicant } from '@webvue/contracts'
import ListPage from '@webvue/ui/app/components/shared/layout/ListPage.vue'
import ListCard from '@webvue/ui/app/components/shared/layout/ListCard.vue'
import DataTable from '@webvue/ui/app/components/shared/data/DataTable.vue'
import SegmentedControl from '@webvue/ui/app/components/shared/data/SegmentedControl.vue'
import StatusBadge from '@webvue/ui/app/components/shared/data/StatusBadge.vue'
import { storyContext } from '../../support/context'

// The applicant list of /hr/recruitment: the shared list page with its status scope,
// the job/stage filters and the table. Static fixtures, no requests.
const applicants: HrApplicant[] = [
  {
    id: 7, partner_name: 'ليلى الحربي', email_from: 'layla@example.com', partner_phone: '+966500000000',
    job: { id: 3, name: 'مهندس واجهات' }, department: { id: 1, name: 'الهندسة' },
    stage: { id: 11, name: 'المقابلة الأولى' }, status: 'ongoing', priority: '2', availability: '2026-11-01',
    refuse_reason: null, employee: null, applied_on: '2026-10-18T08:00:00Z', active: true,
  },
  {
    id: 8, partner_name: 'عمر القحطاني', email_from: 'omar@example.com', partner_phone: '',
    job: { id: 4, name: 'مصمم تجربة' }, department: { id: 2, name: 'المنتج' },
    stage: { id: 15, name: 'تم التعاقد' }, status: 'hired', priority: '3', availability: null,
    refuse_reason: null, employee: { id: 21, name: 'عمر القحطاني' }, applied_on: '2026-10-10T08:00:00Z', active: true,
  },
  {
    id: 9, partner_name: 'رنا العتيبي', email_from: 'rana@example.com', partner_phone: '',
    job: { id: 3, name: 'مهندس واجهات' }, department: { id: 1, name: 'الهندسة' },
    stage: { id: 12, name: 'الفرز' }, status: 'refused', priority: '1', availability: null,
    refuse_reason: { id: 5, name: 'الخبرة غير كافية' }, employee: null, applied_on: '2026-10-08T08:00:00Z', active: false,
  },
]

const columns: TableColumn<HrApplicant>[] = [
  { accessorKey: 'id', header: '#' },
  { accessorKey: 'partner_name', header: 'المتقدم' },
  { accessorKey: 'job', header: 'الوظيفة' },
  { accessorKey: 'stage', header: 'المرحلة' },
  { accessorKey: 'status', header: 'الحالة' },
]

const statusTone = { ongoing: 'info', hired: 'success', refused: 'destructive', archived: 'neutral' } as const

const meta = {
  title: 'HR/Recruitment/ApplicantList',
  component: ListPage,
  parameters: {
    layout: 'fullscreen',
    ...storyContext('apps/web/app/pages/hr/recruitment.vue:123', 'قائمة المتقدمين: نطاق الحالة، ومرشحات الوظيفة والمرحلة من الرابط، وجدول `SharedDataTable bare` داخل بطاقة القائمة.'),
  },
  args: { title: 'التوظيف', createTo: '/hr/recruitment/new', createLabel: 'متقدم جديد', createTestId: 'hr-recruitment-new' },
  render: args => ({
    components: { ListPage, ListCard, DataTable, SegmentedControl, StatusBadge },
    setup: () => ({ args, t: useI18n().t, applicants, columns, statusTone }),
    template: `<ListPage v-bind="args">
      <ListCard>
        <template #filters>
          <SegmentedControl label="الحالة" model-value="all" :items="[{ value: 'all', label: 'الكل' }, { value: 'ongoing', label: 'قيد التوظيف' }, { value: 'hired', label: 'تم التعيين' }, { value: 'refused', label: 'مرفوض' }, { value: 'archived', label: 'مؤرشف' }]" />
        </template>
        <DataTable bare :rows="applicants" :columns="columns" row-key="id" :caption="t('hrRecruitment.title')">
          <template #status-cell="{ row }">
            <StatusBadge size="sm" :tone="statusTone[row.original.status]" :label="t('hrRecruitment.status.' + row.original.status)" />
          </template>
        </DataTable>
      </ListCard>
    </ListPage>`,
  }),
} satisfies Meta<typeof ListPage>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { name: 'قائمة المتقدمين' }
