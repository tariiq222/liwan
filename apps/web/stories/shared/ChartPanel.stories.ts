import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import ChartPanel from '@webvue/ui/app/components/shared/data/ChartPanel.vue'
import DashboardChart from '../../app/components/shared/data/DashboardChart.client.vue'
import { dashboardCharts } from '../fixtures/projectReports'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/ChartPanel',
  component: ChartPanel,
  parameters: {
    layout: 'padded',
    a11y: { test: 'error' },
    ...storyContext('unused', 'بطاقة مخطط واحدة في لوحة: عنوان ووصف وإجراء اختياري، ثم المخطط أو هيكل التحميل أو سطر «لا بيانات». لا ترسم مخططًا بنفسها.'),
  },
  args: { title: '', loading: false, empty: false },
  render: args => ({
    components: { ChartPanel, DashboardChart },
    setup() {
      const { t } = useI18n()
      return { args, t, chart: computed(() => dashboardCharts(t).status) }
    },
    template: `<div class="max-w-xl">
      <ChartPanel v-bind="args" :title="t('projects.dashboard.charts.statusTitle')" :description="t('projects.dashboard.charts.statusDescription')">
        <DashboardChart :chart="chart" variant="pie" :accessible-label="t('projects.dashboard.charts.statusTitle')" />
      </ChartPanel>
    </div>`,
  }),
} satisfies Meta<typeof ChartPanel>
export default meta
type Story = StoryObj<typeof meta>

export const Chart: Story = { name: 'مخطط' }
export const Sizes: Story = {
  name: 'ارتفاع المخطط',
  parameters: storyContext('unused', '`size`: sm 224px وmd 300px (الافتراضي) وlg 360px؛ و`span="full"` يمد اللوحة عمودي الشبكة في `SharedDashboardPage`.'),
  args: { empty: true },
  render: args => ({
    components: { ChartPanel },
    setup: () => ({ args }),
    template: `<div class="grid max-w-xl gap-(--webvue-gap-card)"><ChartPanel v-bind="args" size="sm" title="sm" /><ChartPanel v-bind="args" size="md" title="md" /><ChartPanel v-bind="args" size="lg" title="lg" /></div>`,
  }),
}
export const Loading: Story = { name: 'تحميل', args: { loading: true } }
export const Empty: Story = { name: 'لا بيانات', args: { empty: true } }
export const WithActions: Story = {
  name: 'مع إجراء في الترويسة',
  render: () => ({
    components: { ChartPanel, DashboardChart },
    setup() {
      const { t } = useI18n()
      const currency = ref('SAR')
      const currencies = [{ value: 'SAR', label: 'ريال سعودي (ر.س)' }, { value: 'USD', label: 'US Dollar ($)' }]
      // Unovis measures axis labels once at mount. The 500-weight tick font is not
      // used until the SVG mounts, so fonts.ready alone does not request it.
      const fontsReady = ref(false)
      onMounted(async () => {
        await document.fonts.load('500 12px "IBM Plex Sans Arabic"', '0123456789 مشروع ألفا')
        await document.fonts.ready
        fontsReady.value = true
      })
      return { t, currency, currencies, fontsReady, chart: computed(() => dashboardCharts(t).finance) }
    },
    template: `<div class="max-w-3xl">
      <ChartPanel :title="t('projects.dashboard.charts.financeTitle')" :description="t('projects.dashboard.charts.financeDescription')">
        <template #actions>
          <USelect v-model="currency" :items="currencies" :aria-label="t('projects.dashboard.charts.currency')" class="w-44" />
        </template>
        <DashboardChart v-if="fontsReady" :chart="chart" height="360px" :accessible-label="t('projects.dashboard.charts.financeTitle')" />
      </ChartPanel>
    </div>`,
  }),
}
export const EmptyWithText: Story = {
  name: 'لا بيانات بنص خاص بالمخطط',
  args: { empty: true },
  render: args => ({
    components: { ChartPanel },
    setup: () => ({ args, t: useI18n().t }),
    template: `<div class="max-w-xl">
      <ChartPanel v-bind="args" :title="t('projects.dashboard.charts.budgetHealthTitle')" :description="t('projects.dashboard.charts.budgetHealthDescription')" :empty-text="t('projects.dashboard.charts.noBudgetData')" />
    </div>`,
  }),
}
