import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { useI18n } from 'vue-i18n'
import { computed, ref } from 'vue'
import { ProjectStatusSchema } from '@webvue/contracts'
import FilterBar from '@webvue/ui/app/components/shared/data/FilterBar.vue'
import FilterChip from '@webvue/ui/app/components/shared/data/FilterChip.vue'
import SegmentedControl from '@webvue/ui/app/components/shared/data/SegmentedControl.vue'
import ViewSwitch from '@webvue/ui/app/components/shared/data/ViewSwitch.vue'
import PageContainer from '@webvue/ui/app/components/shared/layout/PageContainer.vue'
import PageHeader from '@webvue/ui/app/components/shared/layout/PageHeader.vue'
import RecordSection from '@webvue/ui/app/components/shared/layout/RecordSection.vue'
import { providePageApp } from '@webvue/ui/app/composables/usePageApp'
import { providePageTrail } from '@webvue/ui/app/composables/usePageTrail'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/PageHeader',
  component: PageHeader,
  parameters: { layout: 'fullscreen' },
  args: { title: '' },
} satisfies Meta<typeof PageHeader>
export default meta
type Story = StoryObj<typeof meta>

export const WithActions: Story = {
  name: 'مع إجراءات الصفحة',
  parameters: storyContext('apps/web/app/pages/projects/[id]/settings.vue:22'),
  render: () => ({
    components: { PageContainer, PageHeader },
    setup: () => ({ t: useI18n().t }),
    template: `<main class="webvue-shell-main"><PageContainer width="list"><PageHeader :title="t('tasks.title')"><template #actions><UButton icon="i-lucide-plus">{{ t('tasks.new') }}</UButton><UButton color="neutral" variant="outline">{{ t('taskLifecycle.archivedTasks') }}</UButton></template></PageHeader></PageContainer></main>`,
  }),
}

export const WithKpiToggle: Story = {
  name: 'مع زر المؤشرات',
  parameters: storyContext('packages/ui/app/components/shared/layout/ListPage.vue:50', '`kpi-toggle` يرسم قبل الإجراءات زر أيقونة دائريًا واحدًا يخفي شريط المؤشرات `SharedKpiStrip` أو يظهره؛ الاختيار عام ويُحفظ في الكوكي `webvue-kpis`.'),
  render: () => ({
    components: { PageContainer, PageHeader },
    setup: () => ({ t: useI18n().t }),
    template: `<main class="webvue-shell-main"><PageContainer width="list"><PageHeader :title="t('tasks.title')" kpi-toggle><template #actions><UButton icon="i-lucide-plus">{{ t('tasks.new') }}</UButton></template></PageHeader></PageContainer></main>`,
  }),
}

// The compact card (DESIGN.md §3): the chip takes the icon of the active application from the shell, so a
// page passes nothing; a title alone is the smallest header.
export const TitleOnly: Story = {
  name: 'عنوان فقط',
  parameters: storyContext('packages/ui/app/components/shared/layout/RecordPage.vue:39', 'أصغر ترويسة: بطاقة مدمجة بأيقونة التطبيق من الغلاف وعنوان واحد، بلا وصف ولا وسوم ولا إجراءات.'),
  render: () => ({
    components: { PageContainer, PageHeader },
    setup: () => {
      providePageApp({ icon: 'i-lucide-folder-kanban' })
      return { t: useI18n().t }
    },
    template: `<main class="webvue-shell-main"><PageContainer width="list"><PageHeader :title="t('projects.title')" /></PageContainer></main>`,
  }),
}

// Tags are short facts about the page's subject (state, count, owner) drawn inline after the title; a tag with `to` is a link.
export const WithTags: Story = {
  name: 'وسوم بعد العنوان',
  parameters: storyContext('packages/ui/app/components/shared/layout/RecordPage.vue:39', 'الوسوم: حالة السجل وعدد القائمة وصاحبه تظهر بعد العنوان في السطر نفسه كشارات ناعمة، والوسم الذي له `to` رابط.'),
  render: () => ({
    components: { PageContainer, PageHeader },
    setup: () => {
      providePageApp({ icon: 'i-lucide-calendar-days' })
      const { t } = useI18n()
      const tags = [
        { label: t('projects.status.at_risk'), tone: 'warning' as const },
        { label: t('nav.projects'), icon: 'i-lucide-folder-kanban', to: '/projects' },
      ]
      return { t, tags }
    },
    template: `<main class="webvue-shell-main"><PageContainer width="list"><PageHeader :title="t('tasks.title')" :tags="tags"><template #actions><UButton icon="i-lucide-plus">{{ t('tasks.new') }}</UButton><UButton color="neutral" variant="outline">{{ t('taskLifecycle.archivedTasks') }}</UButton></template></PageHeader></PageContainer></main>`,
  }),
}

// The trail under the title (DESIGN.md §3): the page's own back target is its nearest step, and the
// shell's published ancestors come before it. A step that only links back to this same page is dropped.
export const WithBack: Story = {
  name: 'مسار تحت العنوان',
  parameters: storyContext('apps/web/app/pages/projects/[id]/finance/[entryId]/edit.vue:67'),
  render: () => ({
    components: { PageContainer, PageHeader },
    setup: () => ({ t: useI18n().t }),
    template: `<main class="webvue-shell-main"><PageContainer width="form"><PageHeader :title="t('app.search')" back-to="/tasks" /></PageContainer></main>`,
  }),
}

// The shell publishes the ancestors; the header draws them under the page title, so the floating header
// above stays quiet and the reader still sees where the page sits.
export const TrailUnderTitle: Story = {
  name: 'مسار الأسلاف تحت العنوان',
  parameters: storyContext('packages/ui/app/components/shared/layout/ListPage.vue:50', 'المسار من الغلاف: ينشر الغلاف سلسلة الأسلاف ويستقبلها رأس الصفحة ويرسمها تحت العنوان، ويُسقط العنوان الحالي والخطوة التي تشير إلى الصفحة نفسها.'),
  render: () => ({
    components: { PageContainer, PageHeader },
    setup: () => {
      const { t } = useI18n()
      providePageTrail([
        { label: t('nav.projects'), to: '/projects' },
        { label: t('projects.dashboard.title'), to: '/projects/dashboard' },
        { label: t('nav.reports'), to: '/projects/dashboard/reports' },
      ])
      return { t }
    },
    template: `<main class="webvue-shell-main"><PageContainer width="list"><PageHeader :title="t('nav.reports')"><template #actions><UButton icon="i-lucide-plus">{{ t('projects.new') }}</UButton></template></PageHeader><div class="rounded-card bg-default p-6 text-sm text-muted ring ring-default">{{ t('app.noResults') }}</div></PageContainer></main>`,
  }),
}

export const TitleAndDescription: Story = {
  name: 'عنوان ووصف',
  parameters: storyContext('apps/web/app/pages/account/settings.vue:47'),
  render: () => ({
    components: { PageContainer, PageHeader },
    setup: () => ({ t: useI18n().t }),
    template: `<main class="webvue-shell-main"><PageContainer width="form"><PageHeader :title="t('account.title')" /></PageContainer></main>`,
  }),
}

// The sticky heading: scroll inside this story's frame and the heading holds its place under the floating header,
// on the shell's canvas wash and blur, while the sections pass beneath it.
export const UnifiedHeaderWithFilters: Story = {
  name: 'الترويسة والفلاتر الموحدة (شامل المكونات)',
  parameters: storyContext('packages/ui/app/components/shared/layout/ListPage.vue:50', 'الترويسة الموحدة لجميع الصفحات: عنوان ووصف مع زر الرجوع، إجراءات الصفحة الأساسية، وشريط الفلاتر المدمج (بحث، منسدلة متعددة، خيارات سريعة، نطاق الحالات، تبديل العرض، وشرائح التصفية النشطة).'),
  render: () => ({
    components: { FilterBar, FilterChip, PageContainer, PageHeader, RecordSection, SegmentedControl, ViewSwitch },
    setup: () => {
      const { t } = useI18n()
      const search = ref('')
      const status = ref('at_risk')
      const scope = ref('active')
      const view = ref('board')
      const sort = ref('default')
      const statusItems = computed(() => [
        { value: 'all', label: t('projects.filters.allStatuses') },
        ...ProjectStatusSchema.options.map(v => ({ value: v, label: t(`projects.status.${v}`) }))
      ])
      const scopeItems = [
        { value: 'active', label: t('projects.filters.active') },
        { value: 'archived', label: t('projects.filters.archived') }
      ]
      const viewOptions = [
        { value: 'board', label: t('projects.views.board'), icon: 'i-lucide-layout-grid' },
        { value: 'list', label: t('projects.views.list'), icon: 'i-lucide-list' }
      ]
      const sortItems = [{ value: 'default', label: 'الترتيب الافتراضي' }, { value: 'name', label: 'الاسم' }]
      return { t, search, status, sort, scope, view, statusItems, sortItems, scopeItems, viewOptions }
    },
    template: `
      <main class="webvue-shell-main">
        <PageContainer width="list">
          <!-- 1. ترويسة الصفحة وإجراءاتها (PageHeader & Actions) -->
          <PageHeader
            :title="t('projects.title')"
            back-to="/projects"
            :back-label="t('projects.title')"
          >
            <template #actions>
              <UButton color="neutral" variant="outline" icon="i-lucide-download">تصدير البيانات</UButton>
              <UButton color="primary" icon="i-lucide-plus">{{ t('projects.new') }}</UButton>
            </template>
          </PageHeader>

          <!-- 2. بطاقة الفلاتر والبحث الموحدة (Unified Filter Card & Bar) -->
          <div class="overflow-hidden rounded-card bg-default ring ring-default">
            <div class="border-b border-default px-(--webvue-card-pad-dense) py-3">
              <FilterBar class="w-full" embedded :active-count="2" @clear="() => {}">
                <!-- البحث السريع -->
                <template #search>
                  <UInput
                    v-model="search"
                    :placeholder="t('projects.filters.search')"
                    icon="i-lucide-search"
                    class="w-full min-w-56"
                  />
                </template>

                <!-- منسدلات وقوائم الاختيار -->
                <template #default>
                  <USelect
                    v-model="status"
                    :items="statusItems"
                    class="w-full md:w-44"
                  />
                  <USelect
                    v-model="sort"
                    :items="sortItems"
                    class="w-full md:w-44"
                  />
                </template>

                <!-- نطاق البيانات وتبديل طريقة العرض -->
                <template #view>
                  <SegmentedControl
                    v-model="scope"
                    :items="scopeItems"
                    label="نطاق العرض"
                  />
                  <ViewSwitch
                    v-model="view"
                    :options="viewOptions"
                  />
                </template>

                <!-- شرائح الفلاتر النشطة القابلة للإزالة -->
                <template #active>
                  <FilterChip :label="t('projects.status.at_risk')" @remove="() => {}" />
                  <FilterChip label="البحث: نظام الموارد" @remove="() => {}" />
                </template>
              </FilterBar>
            </div>

            <!-- محتوى توضيحي داخل البطاقة -->
            <div class="p-8 text-center text-sm text-muted">
              هنا تظهر بيانات الصفحة (سواء كانت جدول بيانات، أو شبكة بطاقات، أو لوحة كانبان، أو مخططات لوحة التحكم) متوافقة تماماً أسفل الترويسة وشريط الفلاتر.
            </div>
          </div>
        </PageContainer>
      </main>
    `
  })
}

export const StickyHeading: Story = {
  name: 'رأس ثابت مع تمرير',
  parameters: storyContext('packages/ui/app/components/shared/layout/ListPage.vue:50', 'الرأس الملتصق: يبقى عنوان الصفحة وإجراءاتها أسفل الهيدر العائم أثناء التمرير، بخلفية ضبابية على لون اللوحة، ولا يلتصق على الجوال (أقل من 768px) ولا حين تملك البطاقة المرساة خانة الالتصاق.'),
  render: () => ({
    components: { PageContainer, PageHeader, RecordSection },
    setup: () => ({ t: useI18n().t, rows: [1, 2, 3, 4, 5, 6, 7, 8] }),
    template: `<div class="webvue-shell" style="height: 30rem; overflow-y: auto"><main class="webvue-shell-main"><PageContainer width="list"><PageHeader :title="t('projects.title')"><template #actions><UButton icon="i-lucide-plus">{{ t('projects.new') }}</UButton></template></PageHeader><div class="grid gap-(--webvue-gap-card)"><RecordSection v-for="row in rows" :key="row" variant="panel" :title="t('projects.title') + ' ' + row"><p class="text-sm text-muted">{{ t('projects.description') }}</p></RecordSection></div></PageContainer></main></div>`,
  }),
}

export const HiddenTitle: Story = {
  name: 'عنوان يملكه الإطار',
  parameters: storyContext('unused', 'داخل إطار مشروع يملك العنوان: `hideTitle` يرسم الإجراءات وحدها ويبقى اسم الصفحة مسجلًا للغلاف.'),
  render: () => ({
    components: { PageContainer, PageHeader },
    setup: () => ({ t: useI18n().t }),
    template: `<main class="webvue-shell-main"><PageContainer width="list"><h1 class="text-xl font-semibold text-highlighted">{{ t('projects.title') }}</h1><PageHeader :title="t('tasks.title')" hide-title><template #actions><UButton icon="i-lucide-plus">{{ t('tasks.new') }}</UButton></template></PageHeader></PageContainer></main>`,
  }),
}
