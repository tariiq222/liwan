import type { Meta, StoryObj } from '@storybook/vue3-vite'
import type { TableColumn } from '@nuxt/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import AppSidebar from '../../app/components/shell/AppSidebar.vue'
import ShellFrame from '../../app/components/shell/ShellFrame.vue'
import ShellHeader from '../../app/components/shell/ShellHeader.vue'
import DataTable from '@nasq/ui/app/components/shared/data/DataTable.vue'
import FilterBar from '@nasq/ui/app/components/shared/data/FilterBar.vue'
import ListPage from '@nasq/ui/app/components/shared/layout/ListPage.vue'
import { __getRouter, useCookie } from '../../.storybook/nuxt-shims'
import { shellHandlers } from '../handlers/shell'
import { people, projectRefs } from '../fixtures/pmo'
import { storyContext } from '../support/context'

interface Row { id: number; name: string; manager: string }
const rows: Row[] = projectRefs.map((project, index) => ({ ...project, manager: people[index % people.length]!.name }))

const meta = {
  title: 'Shared/ListPage',
  component: ListPage,
  parameters: {
    layout: 'fullscreen',
    a11y: { test: 'error' },
    msw: { handlers: { api: shellHandlers } },
    ...storyContext('unused', 'قالب القائمة: العنوان وزر الإنشاء الخاص بالصفحة (`C`) والفلاتر (`/`) ومبدّل العرض المرتبط بـ `?view=`.'),
  },
} satisfies Meta<typeof ListPage>
export default meta
type Story = StoryObj

/** The route a story starts on; loaders run before render. */
const at = (path: string) => async () => {
  await __getRouter()!.replace(path)
  return {}
}

const makePage = (withBack: boolean) => ({
  components: { DataTable, FilterBar, ListPage },
  setup() {
    const { t } = useI18n()
    const views = computed(() => [
      { value: 'table', label: t('projects.filters.tableView'), icon: 'i-lucide-list' },
      { value: 'board', label: t('projects.filters.boardView'), icon: 'i-lucide-layout-grid' },
    ])
    const columns = computed<TableColumn<Row>[]>(() => [
      { accessorKey: 'name', header: t('projects.columns.name') },
      { accessorKey: 'manager', header: t('projects.columns.manager') },
    ])
    return { t, views, columns, rows, rowTo: (row: Row) => `/projects/${row.id}`, createTo: { path: '/projects/new', query: { from: 'list-page' } } }
  },
  template: `<ListPage :title="t('projects.title')" :description="t('projects.description')" :create-to="createTo" :create-label="t('nav.newProject')" :views="views"${withBack ? ` back-to="/projects" :back-label="t('projects.backToProjects')"` : ''}>
    <template #actions><UButton color="neutral" variant="outline">{{ t('projects.filters.archived') }}</UButton></template>
    <template #filters>
      <FilterBar inline><template #search><UInput icon="i-lucide-search" :placeholder="t('projects.filters.search')" :aria-label="t('projects.filters.search')" /></template></FilterBar>
    </template>
    <template #default="{ view }">
      <DataTable v-if="view === 'table'" :rows="rows" :columns="columns" row-key="id" :row-to="rowTo" :caption="t('projects.title')">
        <template #mobile-row="{ row }">
          <ULink :to="rowTo(row)" class="font-medium text-highlighted">{{ row.name }}</ULink>
          <p class="mt-1 text-sm text-muted">{{ row.manager }}</p>
        </template>
      </DataTable>
      <ul v-else class="grid gap-3 sm:grid-cols-3" :aria-label="t('projects.filters.boardView')">
        <li v-for="row in rows" :key="row.id" class="rounded-lg bg-default p-4 ring ring-default">
          <p class="font-medium text-highlighted">{{ row.name }}</p>
          <p class="mt-1 text-sm text-muted">{{ row.manager }}</p>
        </li>
      </ul>
    </template>
  </ListPage>
  <p class="sr-only" data-testid="story-route">{{ $route.fullPath }}</p>`,
})
const page = makePage(false)

export const Default: Story = {
  name: 'قائمة بجدول',
  loaders: [at('/projects')],
  render: () => ({ components: { Page: page }, template: '<main class="nasq-shell-main"><Page /></main>' }),
}

export const Board: Story = {
  name: 'رابط ?view=board',
  loaders: [at('/projects?view=board')],
  render: () => ({ components: { Page: page }, template: '<main class="nasq-shell-main"><Page /></main>' }),
}

export const InShell: Story = {
  name: 'داخل الإطار (C و /)',
  loaders: [at('/projects')],
  render: () => ({
    components: { AppSidebar, Page: page, ShellFrame, ShellHeader },
    setup: () => { useCookie<'open' | 'closed'>('nasq-context-sidebar').value = 'open' },
    template: `<ShellFrame>
      <template #header><ShellHeader /></template>
      <template #sidebar><AppSidebar /></template>
      <main class="nasq-shell-main" data-testid="shell-main"><Page /></main>
    </ShellFrame>`,
  }),
}

export const WithBack: Story = {
  name: 'مع رابط الرجوع',
  loaders: [at('/projects')],
  render: () => ({ components: { Page: makePage(true) }, template: '<main class="nasq-shell-main"><Page /></main>' }),
}
