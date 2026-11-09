import type { Meta, StoryObj } from '@storybook/vue3-vite'
import type { TableColumn } from '@nuxt/ui'
import { computed, h, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import DataTable from '@liwan/ui/app/components/shared/data/DataTable.vue'
import FilterBar from '@liwan/ui/app/components/shared/data/FilterBar.vue'
import ListCard from '@liwan/ui/app/components/shared/layout/ListCard.vue'
import PageContainer from '@liwan/ui/app/components/shared/layout/PageContainer.vue'
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

const table = (state: { rows?: Row[]; loading?: boolean; error?: unknown; selectable?: boolean; selected?: number[]; density?: 'dense' | 'comfortable'; sortable?: boolean; sort?: { column: string; direction: 'asc' | 'desc' } | null } = {}) => ({
  components: { DataTable, FilterBar, ListCard, PageContainer },
  setup() {
    const { t } = useI18n()
    const selected = ref<(string | number)[]>(state.selected ?? [])
    const sort = ref(state.sort ?? null)
    const columns = computed<TableColumn<Row>[]>(() => [
      { accessorKey: 'name', header: t('projects.columns.name'), meta: state.sortable ? { sortable: true } : undefined },
      { accessorKey: 'manager', header: t('projects.columns.manager') },
    ])
    return { t, columns, selected, sort, rows: state.rows ?? rows, loading: state.loading ?? false, error: state.error, selectable: state.selectable ?? false, density: state.density ?? 'dense', rowTo: (row: Row) => `/projects/${row.id}` }
  },
  template: `<main class="liwan-shell-main"><PageContainer>
    <DataTable v-model:selected="selected" :rows="rows" :columns="columns" row-key="id" :row-to="rowTo" :caption="t('projects.title')"
      :loading="loading" :error="error" :selectable="selectable" :density="density" :page="1" :pages="3" :empty-text="t('projects.empty')" v-model:sort="sort" :sort-keys="{ name: 'name' }">
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
    <p class="sr-only" data-testid="story-sort">{{ sort ? sort.column + ' ' + sort.direction : 'none' }}</p>
    <p class="sr-only" data-testid="story-route">{{ $route.fullPath }}</p>
  </PageContainer></main>`,
})

export const Default: Story = { name: 'جدول بروابط الصفوف', render: () => table() }
export const Comfortable: Story = { name: 'مريح (الرئيسية ولوحات النظرة العامة)', render: () => table({ density: 'comfortable' }) }
const inCard = (empty = false) => ({
  components: { DataTable, FilterBar, ListCard, PageContainer },
  setup() {
    const { t } = useI18n()
    const columns = computed<TableColumn<Row>[]>(() => [
      { accessorKey: 'name', header: t('projects.columns.name') },
      { accessorKey: 'manager', header: t('projects.columns.manager') },
    ])
    return { t, columns, rows: empty ? [] : rows, rowTo: (row: Row) => `/projects/${row.id}` }
  },
  template: `<main class="liwan-shell-main"><PageContainer><ListCard>
    <template #filters><FilterBar embedded><template #search><UInput icon="i-lucide-search" :placeholder="t('projects.filters.search')" :aria-label="t('projects.filters.search')" /></template></FilterBar></template>
    <DataTable bare :rows="rows" :columns="columns" row-key="id" :row-to="rowTo" :caption="t('projects.title')" :empty-text="t('projects.empty')">
      <template #footer><span class="tabular-nums">{{ rows.length }} / 128</span><UButton color="neutral" variant="outline" size="sm">{{ t('app.loadMore') }}</UButton></template>
    </DataTable>
  </ListCard></PageContainer></main>`,
})
export const InListCard: Story = { name: 'داخل بطاقة قائمة: فلاتر في الترويسة وتذييل بعدد النتائج', render: () => inCard() }
export const InListCardEmpty: Story = { name: 'داخل بطاقة قائمة: حالة فارغة', render: () => inCard(true) }
export const Sortable: Story = { name: 'عمود قابل للترتيب (بلا ترتيب، ينقر فيصير تصاعديًا ثم تنازليًا ثم يعود)', render: () => table({ sortable: true }) }
export const SortedAscending: Story = { name: 'مرتّب تصاعديًا', render: () => table({ sortable: true, sort: { column: 'name', direction: 'asc' } }) }
export const SortedDescending: Story = { name: 'مرتّب تنازليًا', render: () => table({ sortable: true, sort: { column: 'name', direction: 'desc' } }) }
export const Selectable: Story = { name: 'تحديد وشريط إجراءات', render: () => table({ selectable: true, selected: [2] }) }
export const Loading: Story = { name: 'تحميل', render: () => table({ rows: [], loading: true }) }
export const Empty: Story = { name: 'فارغ', render: () => table({ rows: [] }) }
export const ErrorState: Story = { name: 'خطأ', render: () => table({ rows: [], error: { status: 500 } }) }

interface WideRow extends Row { stage: string; budget: number; updated: string }
const wideRows: WideRow[] = rows.map((row, index) => ({ ...row, stage: ['planning', 'active', 'review'][index % 3]!, budget: 120000 + index * 37500, updated: `2026-11-0${(index % 8) + 1}` }))
// A card of `width` px: many columns and a trailing actions column. Wide enough it is a table; narrower than 640px it
// stacks into row cards; in between it would scroll inside the card with the first column and the actions pinned.
const framed = (width: string) => ({
  components: { DataTable, ListCard, PageContainer },
  setup() {
    const { t } = useI18n()
    const columns = computed<TableColumn<WideRow>[]>(() => [
      { accessorKey: 'name', header: t('projects.columns.name'), meta: { class: { th: 'min-w-[180px]', td: 'min-w-[180px]' } } as TableColumn<WideRow>['meta'] },
      { accessorKey: 'manager', header: t('projects.columns.manager'), meta: { class: { th: 'min-w-[140px]', td: 'min-w-[140px]' } } as TableColumn<WideRow>['meta'] },
      { accessorKey: 'stage', header: 'Stage', meta: { class: { th: 'min-w-[120px]', td: 'min-w-[120px]' } } as TableColumn<WideRow>['meta'] },
      { accessorKey: 'budget', header: 'Budget', meta: { numeric: true, class: { th: 'min-w-[120px]', td: 'min-w-[120px]' } } as TableColumn<WideRow>['meta'] },
      { accessorKey: 'updated', header: 'Updated', meta: { class: { th: 'min-w-[120px]', td: 'min-w-[120px]' } } as TableColumn<WideRow>['meta'] },
      { id: 'actions', header: () => h('span', { class: 'sr-only' }, 'Actions'), meta: { class: { th: 'w-12', td: 'w-12 text-end' } } as TableColumn<WideRow>['meta'] },
    ])
    return { t, columns, rows: wideRows, width, rowTo: (row: Row) => `/projects/${row.id}` }
  },
  template: `<main class="liwan-shell-main"><PageContainer><div :style="{ width, maxWidth: '100%' }"><ListCard>
    <DataTable bare :rows="rows" :columns="columns" row-key="id" :row-to="rowTo" :caption="t('projects.title')" :empty-text="t('projects.empty')">
      <template #actions-cell><UButton color="neutral" variant="ghost" size="sm" icon="i-lucide-ellipsis" aria-label="Row actions" /></template>
      <template #footer><span class="tabular-nums">{{ rows.length }} / 128</span></template>
    </DataTable>
  </ListCard></div></PageContainer></main>`,
})
export const Narrow: Story = { name: 'ضيق: يمرّر داخل البطاقة، عمود أول وعمود إجراءات ثابتان', render: () => framed('760px') }
export const Mobile: Story = { name: 'جوال: كل صف بطاقة، العنوان ثم أزواج تسمية وقيمة ثم الإجراءات', render: () => framed('390px') }
