import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { ProjectStatusSchema } from '@nasq/contracts'
import ProjectStatusBadge from '../../app/components/project/ProjectStatusBadge.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Project/ProjectStatusBadge',
  component: ProjectStatusBadge,
  args: { status: 'on_track' },
  argTypes: { status: { control: 'select', options: [...ProjectStatusSchema.options, null] } },
} satisfies Meta<typeof ProjectStatusBadge>
export default meta
type Story = StoryObj<typeof meta>

export const InOverviewRow: Story = {
  name: 'في سطر ملخص المشروع',
  parameters: storyContext('apps/web/app/components/project/ProjectOverview.vue:50'),
  render: args => ({
    components: { ProjectStatusBadge },
    setup: () => ({ args, statuses: [...ProjectStatusSchema.options, null] }),
    template: `<div class="space-y-3"><div class="flex flex-wrap items-center gap-3 text-sm"><ProjectStatusBadge v-bind="args" /><span class="text-muted">2026-09-01 — 2026-12-31</span></div><div class="flex flex-wrap items-center gap-3 text-sm"><ProjectStatusBadge v-for="status in statuses" :key="String(status)" :status="status" /></div></div>`,
  }),
}

export const InTableCell: Story = {
  name: 'في خلية جدول المشاريع',
  parameters: storyContext('apps/web/app/components/project/ProjectTable.vue:85'),
  render: () => ({
    components: { ProjectStatusBadge },
    setup: () => {
      const { t } = useI18n()
      const data = ProjectStatusSchema.options.map((status, index) => ({ id: index + 1, name: `مشروع ${index + 1}`, status }))
      const columns = [{ accessorKey: 'name', header: t('projects.columns.name') }, { accessorKey: 'status', header: t('projects.columns.status') }]
      return { data, columns }
    },
    template: `<div class="hidden md:block"><div class="nasq-ui-record-surface"><div class="overflow-x-auto"><UTable :data="data" :columns="columns" :ui="{ caption: 'sr-only', thead: 'nasq-ui-table-head' }"><template #status-cell="{ row }"><ProjectStatusBadge :status="row.original.status" /></template></UTable></div></div></div>`,
  }),
}
