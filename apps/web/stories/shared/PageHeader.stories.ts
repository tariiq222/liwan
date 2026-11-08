import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { useI18n } from 'vue-i18n'
import { computed, ref } from 'vue'
import { ProjectStatusSchema } from '@liwan/contracts'
import FilterBar from '@liwan/ui/app/components/shared/data/FilterBar.vue'
import FilterChip from '@liwan/ui/app/components/shared/data/FilterChip.vue'
import SegmentedControl from '@liwan/ui/app/components/shared/data/SegmentedControl.vue'
import ViewSwitch from '@liwan/ui/app/components/shared/data/ViewSwitch.vue'
import PageContainer from '@liwan/ui/app/components/shared/layout/PageContainer.vue'
import PageHeader from '@liwan/ui/app/components/shared/layout/PageHeader.vue'
import RecordSection from '@liwan/ui/app/components/shared/layout/RecordSection.vue'
import RouteTabs from '@liwan/ui/app/components/shared/layout/RouteTabs.vue'
import { providePageApp } from '@liwan/ui/app/composables/usePageApp'
import { providePageTrail } from '@liwan/ui/app/composables/usePageTrail'
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
  parameters: storyContext('packages/ui/app/components/shared/layout/ListPage.vue:49'),
  render: () => ({
    components: { PageContainer, PageHeader },
    setup: () => ({ t: useI18n().t }),
    template: `<main class="liwan-shell-main"><PageContainer><PageHeader :title="t('tasks.title')"><template #actions><UButton icon="i-lucide-plus">{{ t('tasks.new') }}</UButton><UButton color="neutral" variant="outline">{{ t('taskLifecycle.archivedTasks') }}</UButton></template></PageHeader></PageContainer></main>`,
  }),
}

export const WithKpiToggle: Story = {
  name: 'مع زر المؤشرات',
  parameters: storyContext('packages/ui/app/components/shared/layout/ListPage.vue:49', '`kpi-toggle` يرسم قبل الإجراءات زر أيقونة دائريًا واحدًا يخفي شريط المؤشرات `SharedKpiStrip` أو يظهره؛ الاختيار عام ويُحفظ في الكوكي `liwan-kpis`.'),
  render: () => ({
    components: { PageContainer, PageHeader },
    setup: () => ({ t: useI18n().t }),
    template: `<main class="liwan-shell-main"><PageContainer><PageHeader :title="t('tasks.title')" kpi-toggle><template #actions><UButton icon="i-lucide-plus">{{ t('tasks.new') }}</UButton></template></PageHeader></PageContainer></main>`,
  }),
}

// The open header (DESIGN.md §3): the 64px tile takes the icon of the active application from the shell, so a
// page passes nothing; a title alone is the smallest header.
export const TitleOnly: Story = {
  name: 'عنوان فقط',
  parameters: storyContext('packages/ui/app/components/shared/layout/RecordPage.vue:40', 'أصغر ترويسة: ترويسة مفتوحة بلا بطاقة، ببلاطة التطبيق من الغلاف وعنوان واحد وخط فاصل، بلا وصف ولا وسوم ولا إجراءات.'),
  render: () => ({
    components: { PageContainer, PageHeader },
    setup: () => {
      providePageApp({ icon: 'i-lucide-folder-kanban' })
      return { t: useI18n().t }
    },
    template: `<main class="liwan-shell-main"><PageContainer><PageHeader :title="t('projects.title')" /></PageContainer></main>`,
  }),
}

// Tags are short facts about the page's subject (state, count, owner) drawn inline after the title; a tag with `to` is a link.
export const WithTags: Story = {
  name: 'وسوم بعد العنوان',
  parameters: storyContext('packages/ui/app/components/shared/layout/RecordPage.vue:40', 'الوسوم: حالة السجل وعدد القائمة وصاحبه تظهر بعد العنوان في السطر نفسه كشارات ناعمة، والوسم الذي له `to` رابط.'),
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
    template: `<main class="liwan-shell-main"><PageContainer><PageHeader :title="t('tasks.title')" :tags="tags"><template #actions><UButton icon="i-lucide-plus">{{ t('tasks.new') }}</UButton><UButton color="neutral" variant="outline">{{ t('taskLifecycle.archivedTasks') }}</UButton></template></PageHeader></PageContainer></main>`,
  }),
}

// The trail above the title (DESIGN.md §3): the page's own back target is its nearest step, and the
// shell's published ancestors come before it. A step that only links back to this same page is dropped.
export const WithBack: Story = {
  name: 'مسار فوق العنوان',
  parameters: storyContext('packages/ui/app/components/shared/layout/RecordPage.vue:40'),
  render: () => ({
    components: { PageContainer, PageHeader },
    setup: () => ({ t: useI18n().t }),
    template: `<main class="liwan-shell-main"><PageContainer><PageHeader :title="t('app.search')" back-to="/tasks" /></PageContainer></main>`,
  }),
}

// The shell publishes the ancestors; the header draws them above the page title, so the top bar
// stays quiet and the reader still sees where the page sits.
export const TrailUnderTitle: Story = {
  name: 'مسار الأسلاف فوق العنوان',
  parameters: storyContext('packages/ui/app/components/shared/layout/ListPage.vue:49', 'المسار من الغلاف: ينشر الغلاف سلسلة الأسلاف ويستقبلها رأس الصفحة ويرسمها فوق العنوان، ويُسقط العنوان الحالي والخطوة التي تشير إلى الصفحة نفسها.'),
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
    template: `<main class="liwan-shell-main"><PageContainer><PageHeader :title="t('nav.reports')"><template #actions><UButton icon="i-lucide-plus">{{ t('projects.new') }}</UButton></template></PageHeader><div class="liwan-card rounded-card p-6 text-sm text-muted">{{ t('app.noResults') }}</div></PageContainer></main>`,
  }),
}

export const TitleAndDescription: Story = {
  name: 'عنوان ووصف',
  parameters: storyContext('apps/web/app/pages/account/settings.vue:47'),
  render: () => ({
    components: { PageContainer, PageHeader },
    setup: () => ({ t: useI18n().t }),
    template: `<main class="liwan-shell-main"><PageContainer><PageHeader :title="t('account.title')" /></PageContainer></main>`,
  }),
}

// The open header over the page toolbar: filters, quick choices, the scope and view switches and the active filter chips.
export const UnifiedHeaderWithFilters: Story = {
  name: 'الترويسة والفلاتر الموحدة (شامل المكونات)',
  parameters: storyContext('packages/ui/app/components/shared/layout/ListPage.vue:49', 'الترويسة الموحدة لجميع الصفحات: عنوان ووصف مع زر الرجوع، إجراءات الصفحة الأساسية، وشريط الفلاتر المدمج (بحث، منسدلة متعددة، خيارات سريعة، نطاق الحالات، تبديل العرض، وشرائح التصفية النشطة).'),
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
      <main class="liwan-shell-main">
        <PageContainer>
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
          <div class="liwan-card overflow-hidden rounded-card">
            <div class="border-b border-default px-(--liwan-card-pad-dense) py-3">
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

// The mock's page header: breadcrumb, a 64px application tile, the title in Rubik with the tagline under it, the actions at the
// inline end in the application's button colour, and the views tabs on the 1px divider (the active one underlined 2.5px with its count).
export const WithTaglineAndTabs: Story = {
  name: 'وصف وتبويبات العروض',
  parameters: storyContext('packages/ui/app/components/shared/layout/ListPage.vue:49', 'الترويسة المفتوحة كما في النموذج: مسار، بلاطة 64px بلون التطبيق، العنوان بخط Rubik وتحته سطر وصف، الإجراءات عند نهاية السطر بلون زر التطبيق، وفي الأسفل تبويبات العروض فوق الخط الفاصل (الفتحة `tabs`).'),
  render: () => ({
    components: { PageContainer, PageHeader, RouteTabs },
    setup: () => {
      providePageApp({ icon: 'i-lucide-handshake', id: 'crm', label: 'إدارة العملاء', tagline: 'لا تضيع صفقة بعد اليوم' })
      const tabs = [
        { key: 'crm-tab-dashboard', label: 'لوحة المتابعة', to: '/crm', active: false },
        { key: 'crm-tab-opportunities', label: 'الفرص', to: '/crm/opportunities', active: true, count: 12 },
        { key: 'crm-tab-import', label: 'الاستيراد', to: '/crm/import', active: false },
      ]
      return { tabs }
    },
    template: `<main class="liwan-shell-main" data-app="crm"><PageContainer><PageHeader title="الفرص"><template #actions><UButton color="neutral" variant="soft" icon="i-lucide-file-up">الاستيراد</UButton><UButton icon="i-lucide-plus">إضافة فرصة</UButton></template><template #tabs><RouteTabs :items="tabs" aria-label="أقسام العملاء" /></template></PageHeader></PageContainer></main>`,
  }),
}

export const HiddenTitle: Story = {
  name: 'عنوان يملكه الإطار',
  parameters: storyContext('packages/ui/app/components/shared/layout/RecordPage.vue:40', 'داخل إطار مشروع يملك العنوان: `hideTitle` يرسم الإجراءات وحدها ويبقى اسم الصفحة مسجلًا للغلاف.'),
  render: () => ({
    components: { PageContainer, PageHeader },
    setup: () => ({ t: useI18n().t }),
    template: `<main class="liwan-shell-main"><PageContainer><h1 class="text-xl font-semibold text-highlighted">{{ t('projects.title') }}</h1><PageHeader :title="t('tasks.title')" hide-title><template #actions><UButton icon="i-lucide-plus">{{ t('tasks.new') }}</UButton></template></PageHeader></PageContainer></main>`,
  }),
}
