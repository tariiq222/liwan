import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { fn } from 'storybook/test'
import { ProjectStatusSchema } from '@webvue/contracts'
import FilterBar from '@webvue/ui/app/components/shared/data/FilterBar.vue'
import PageContainer from '@webvue/ui/app/components/shared/layout/PageContainer.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/FilterBar',
  component: FilterBar,
  parameters: { layout: 'fullscreen', a11y: { test: 'error' }, ...storyContext('apps/web/app/pages/projects/index.vue:263') },
  args: { activeCount: 0, disabled: false, defaultOpen: false, onClear: fn() },
  render: args => ({
    components: { FilterBar, PageContainer },
    setup() {
      const { t } = useI18n()
      const status = ref('all')
      const items = computed(() => [{ value: 'all', label: t('projects.filters.allStatuses') }, ...ProjectStatusSchema.options.map(value => ({ value, label: t(`projects.status.${value}`) }))])
      return { args, t, status, items, search: ref('') }
    },
    template: `<main class="webvue-shell-main"><PageContainer width="list"><div class="w-full min-w-0" data-testid="projects-toolbar"><FilterBar class="w-full" v-bind="args"><template #search><UInput v-model="search" :placeholder="t('projects.filters.search')" :aria-label="t('projects.filters.search')" icon="i-lucide-search" class="w-full min-w-52" /></template><template #default><USelect v-model="status" :items="items" class="w-40" /></template><template #active><UBadge color="primary" variant="subtle">{{ t('projects.status.at_risk') }}</UBadge></template></FilterBar></div></PageContainer></main>`,
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
    template: `<main class="webvue-shell-main"><PageContainer width="list"><div class="overflow-hidden rounded-card bg-default ring ring-default"><div class="border-b border-default px-(--webvue-card-pad-dense) py-3"><FilterBar class="w-full" embedded v-bind="args"><template #search><UInput v-model="search" :placeholder="t('projects.filters.search')" :aria-label="t('projects.filters.search')" icon="i-lucide-search" class="w-full min-w-52" /></template><template #default><USelect v-model="status" multiple :items="items" :placeholder="t('projects.filters.allStatuses')" :aria-label="t('projects.filters.allStatuses')" class="w-full md:w-44" /></template></FilterBar></div></div></PageContainer></main>`,
  }),
}
export const Disabled: Story = { name: 'معطّل', args: { disabled: true, activeCount: 1 } }
