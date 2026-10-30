import type { Meta, StoryObj } from '@storybook/vue3-vite'
import type { TableColumn } from '@nuxt/ui'
import { useI18n } from 'vue-i18n'
import type { HrRecruitmentJob } from '@liwan/contracts'
import ListPage from '@liwan/ui/app/components/shared/layout/ListPage.vue'
import ListCard from '@liwan/ui/app/components/shared/layout/ListCard.vue'
import DataTable from '@liwan/ui/app/components/shared/data/DataTable.vue'
import SegmentedControl from '@liwan/ui/app/components/shared/data/SegmentedControl.vue'
import StatusBadge from '@liwan/ui/app/components/shared/data/StatusBadge.vue'
import { storyContext } from '../../support/context'

// The job-position list of /hr/recruitment/jobs: the active/archived scope, the search and
// the table with LiwanOS's own ongoing-applicant count. Static fixtures, no requests.
const jobs: HrRecruitmentJob[] = [
  { id: 3, name: 'مهندس واجهات', department: { id: 1, name: 'الهندسة' }, no_of_recruitment: 2, application_count: 6, description: '', active: true },
  { id: 4, name: 'مصمم تجربة', department: { id: 2, name: 'المنتج' }, no_of_recruitment: 1, application_count: 3, description: '', active: true },
  { id: 5, name: 'محلل مالي', department: { id: 3, name: 'المالية' }, no_of_recruitment: 0, application_count: 0, description: '', active: false },
]

const columns: TableColumn<HrRecruitmentJob>[] = [
  { accessorKey: 'id', header: '#' },
  { accessorKey: 'name', header: 'الوظيفة' },
  { accessorKey: 'department', header: 'القسم' },
  { accessorKey: 'no_of_recruitment', header: 'العدد المطلوب' },
  { accessorKey: 'application_count', header: 'المتقدمون' },
  { accessorKey: 'active', header: 'الحالة' },
]

const meta = {
  title: 'HR/Recruitment/JobList',
  component: ListPage,
  parameters: {
    layout: 'fullscreen',
    ...storyContext('apps/web/app/pages/hr/recruitment/jobs.vue:97', 'قائمة الوظائف: نطاق النشطة والمؤرشفة، والبحث، وجدول يعرض العدد المطلوب وعدد المتقدمين القيد لكل وظيفة.'),
  },
  args: { title: 'الوظائف', createTo: '/hr/recruitment/jobs/new', createLabel: 'وظيفة جديدة', createTestId: 'hr-recruitment-job-new' },
  render: args => ({
    components: { ListPage, ListCard, DataTable, SegmentedControl, StatusBadge },
    setup: () => ({ args, t: useI18n().t, jobs, columns }),
    template: `<ListPage v-bind="args">
      <ListCard>
        <template #filters>
          <SegmentedControl label="الحالة" model-value="true" :items="[{ value: 'true', label: 'النشطة' }, { value: 'false', label: 'المؤرشفة' }, { value: 'all', label: 'الكل' }]" />
        </template>
        <DataTable bare :rows="jobs" :columns="columns" row-key="id" :caption="t('hrRecruitment.jobs.title')">
          <template #department-cell="{ row }">{{ row.original.department?.name || t('hrRecruitment.noDepartment') }}</template>
          <template #active-cell="{ row }">
            <StatusBadge size="sm" :tone="row.original.active ? 'success' : 'neutral'" :label="row.original.active ? t('hrRecruitment.jobs.state.active') : t('hrRecruitment.jobs.state.archived')" />
          </template>
        </DataTable>
      </ListCard>
    </ListPage>`,
  }),
} satisfies Meta<typeof ListPage>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { name: 'قائمة الوظائف' }
