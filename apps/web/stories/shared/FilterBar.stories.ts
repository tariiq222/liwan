import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { fn } from 'storybook/test'
import { ProjectStatusSchema } from '@liwan/contracts'
import FilterBar from '@liwan/ui/app/components/shared/data/FilterBar.vue'
import PageContainer from '@liwan/ui/app/components/shared/layout/PageContainer.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/FilterBar',
  component: FilterBar,
  parameters: { layout: 'fullscreen', a11y: { test: 'error' }, ...storyContext('apps/web/app/pages/projects/index.vue:281') },
  args: { activeCount: 0, disabled: false, defaultOpen: false, onClear: fn() },
  render: args => ({
    components: { FilterBar, PageContainer },
    setup() {
      const { t } = useI18n()
      const status = ref('all')
      const items = computed(() => [{ value: 'all', label: t('projects.filters.allStatuses') }, ...ProjectStatusSchema.options.map(value => ({ value, label: t(`projects.status.${value}`) }))])
      return { args, t, status, items, search: ref('') }
    },
    template: `<main class="liwan-shell-main"><PageContainer width="list"><div class="w-full min-w-0" data-testid="projects-toolbar"><FilterBar class="w-full" v-bind="args"><template #search><UInput v-model="search" :placeholder="t('projects.filters.search')" :aria-label="t('projects.filters.search')" icon="i-lucide-search" class="w-full min-w-52" /></template><template #default><USelect v-model="status" :items="items" class="w-40" /></template><template #active><UBadge color="primary" variant="subtle">{{ t('projects.status.at_risk') }}</UBadge></template></FilterBar></div></PageContainer></main>`,
  }),
} satisfies Meta<typeof FilterBar>
export default meta
type Story = StoryObj<typeof meta>

export const InPageToolbar: Story = { name: 'شريط أدوات صفحة' }
export const WithActiveFilters: Story = { name: 'مع فلاتر نشطة', args: { activeCount: 2 } }
export const FiltersOpen: Story = { name: 'نافذة الفلاتر مفتوحة', args: { defaultOpen: true } }
export const EmbeddedInCardHeader: Story = {
  name: 'مدمج في ترويسة بطاقة (صف واحد)',
  render: args => ({
    components: { FilterBar, PageContainer },
    setup() {
      const { t } = useI18n()
      const status = ref<string[]>([])
      const items = computed(() => ProjectStatusSchema.options.map(value => ({ value, label: t(`projects.status.${value}`) })))
      return { args, t, status, items, search: ref('') }
    },
    template: `<main class="liwan-shell-main"><PageContainer width="list"><div class="overflow-hidden rounded-card bg-default ring ring-default"><div class="border-b border-default px-(--liwan-card-pad-dense) py-3"><FilterBar class="w-full" embedded v-bind="args"><template #search><UInput v-model="search" :placeholder="t('projects.filters.search')" :aria-label="t('projects.filters.search')" icon="i-lucide-search" class="w-full min-w-52" /></template><template #default><USelect v-model="status" multiple :items="items" :placeholder="t('projects.filters.allStatuses')" :aria-label="t('projects.filters.allStatuses')" class="w-full md:w-44" /></template></FilterBar></div></div></PageContainer></main>`,
  }),
}
export const EmbeddedTaskFilters: Story = {
  name: 'مدمج: فلاتر المهام (الأولوية والمسؤول والموعد)',
  args: { activeCount: 2 },
  render: args => ({
    components: { FilterBar, PageContainer },
    setup() {
      const { t } = useI18n()
      const priority = ref(['3', '2'])
      const assignee = ref('me')
      const priorityItems = computed(() => ['3', '2', '1', '0'].map(value => ({ value, label: t(`tasks.priority.${value}`) })))
      const assigneeItems = computed(() => [
        { value: 'all', label: t('tasks.filters.assigneeAll') },
        { value: 'me', label: t('tasks.filters.assigneeMe') },
        { value: 'none', label: t('tasks.filters.assigneeNone') },
      ])
      const deadlineItems = computed(() => [
        { value: 'all', label: t('tasks.filters.deadlineAll') },
        { value: 'overdue', label: t('tasks.filters.deadlineOverdue') },
        { value: 'today', label: t('tasks.deadline.today') },
        { value: 'week', label: t('tasks.filters.deadlineWeek') },
        { value: 'none', label: t('tasks.deadline.none') },
      ])
      return { args, t, priority, assignee, priorityItems, assigneeItems, deadlineItems, deadline: ref(undefined), search: ref('') }
    },
    template: `<main class="liwan-shell-main"><PageContainer width="list"><div class="overflow-hidden rounded-card bg-default ring ring-default"><div class="border-b border-default px-(--liwan-card-pad-dense) py-3"><FilterBar class="w-full" embedded v-bind="args"><template #search><UInput v-model="search" :placeholder="t('tasks.filters.search')" :aria-label="t('tasks.filters.search')" icon="i-lucide-search" class="w-full min-w-52" /></template><template #default><USelect v-model="priority" multiple icon="i-lucide-flag" :items="priorityItems" :placeholder="t('tasks.filters.priorityLabel')" :aria-label="t('tasks.filters.priorityLabel')" class="w-full md:w-40" /><USelect v-model="assignee" icon="i-lucide-user" :items="assigneeItems" :placeholder="t('tasks.filters.assigneeLabel')" :aria-label="t('tasks.filters.assigneeLabel')" class="w-full md:w-40" /><USelect v-model="deadline" icon="i-lucide-calendar-clock" :items="deadlineItems" :placeholder="t('tasks.filters.deadlineLabel')" :aria-label="t('tasks.filters.deadlineLabel')" class="w-full md:w-40" /></template></FilterBar></div></div></PageContainer></main>`,
  }),
}
export const Disabled: Story = { name: 'معطّل', args: { disabled: true, activeCount: 1 } }
