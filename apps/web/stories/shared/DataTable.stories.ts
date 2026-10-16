import type { Meta, StoryObj } from '@storybook/vue3-vite'
import type { TableColumn } from '@nuxt/ui'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import DataTable from '@webvue/ui/app/components/shared/data/DataTable.vue'
import FilterBar from '@webvue/ui/app/components/shared/data/FilterBar.vue'
import PageContainer from '@webvue/ui/app/components/shared/layout/PageContainer.vue'
import { people, projectRefs } from '../fixtures/pmo'
import { storyContext } from '../support/context'

interface Row { id: number; name: string; manager: string }
const rows: Row[] = projectRefs.map((project, index) => ({ ...project, manager: people[index % people.length]!.name }))

const meta = {
  title: 'Shared/DataTable',
  component: DataTable,
  parameters: {
    layout: 'fullscreen',
    a11y: { test: 'error' },
    ...storyContext('unused', 'قالب القائمة: الفلاتر وشريط التحديد والجدول وصفوف الجوال والحالات والترقيم. J وK تتنقلان بين الصفوف الظاهرة فقط، وEnter يفتح الصف.'),
  },
} satisfies Meta<typeof DataTable>
export default meta
type Story = StoryObj

const table = (state: { rows?: Row[]; loading?: boolean; error?: unknown; selectable?: boolean; selected?: number[] } = {}) => ({
  components: { DataTable, FilterBar, PageContainer },
  setup() {
    const { t } = useI18n()
    const selected = ref<(string | number)[]>(state.selected ?? [])
    const columns = computed<TableColumn<Row>[]>(() => [
      { accessorKey: 'name', header: t('projects.columns.name') },
      { accessorKey: 'manager', header: t('projects.columns.manager') },
    ])
    return { t, columns, selected, rows: state.rows ?? rows, loading: state.loading ?? false, error: state.error, selectable: state.selectable ?? false, rowTo: (row: Row) => `/projects/${row.id}` }
  },
  template: `<main class="webvue-shell-main"><PageContainer width="list">
    <DataTable v-model:selected="selected" :rows="rows" :columns="columns" row-key="id" :row-to="rowTo" :caption="t('projects.title')"
      :loading="loading" :error="error" :selectable="selectable" :page="1" :pages="3" :empty-text="t('projects.empty')">
      <template #filters>
        <FilterBar inline><template #search><UInput icon="i-lucide-search" :placeholder="t('projects.filters.search')" :aria-label="t('projects.filters.search')" /></template></FilterBar>
      </template>
      <template #bulk="{ clear }">
        <UButton color="neutral" variant="outline" size="sm" icon="i-lucide-archive" @click="clear">{{ t('projects.menu.archive') }}</UButton>
      </template>
      <template #mobile-row="{ row }">
        <ULink :to="rowTo(row)" class="font-medium text-highlighted">{{ row.name }}</ULink>
        <p class="mt-1 text-sm text-muted">{{ row.manager }}</p>
      </template>
    </DataTable>
    <p class="sr-only" data-testid="story-route">{{ $route.fullPath }}</p>
  </PageContainer></main>`,
})

export const Default: Story = { name: 'جدول بروابط الصفوف', render: () => table() }
export const Selectable: Story = { name: 'تحديد وشريط إجراءات', render: () => table({ selectable: true, selected: [2] }) }
export const Loading: Story = { name: 'تحميل', render: () => table({ rows: [], loading: true }) }
export const Empty: Story = { name: 'فارغ', render: () => table({ rows: [] }) }
export const ErrorState: Story = { name: 'خطأ', render: () => table({ rows: [], error: { status: 500 } }) }
