import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import ViewSwitch from '../../app/components/shared/ViewSwitch.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/ViewSwitch',
  component: ViewSwitch,
  parameters: { layout: 'padded', a11y: { test: 'error' }, ...storyContext('apps/web/app/components/shared/ListPage.vue:59', 'مبدّل القائمة واللوحة؛ تربطه `SharedListPage` بمعامل `?view=` في الرابط.') },
} satisfies Meta<typeof ViewSwitch>
export default meta
type Story = StoryObj

export const Default: Story = {
  name: 'جدول ولوحة',
  render: () => ({
    components: { ViewSwitch },
    setup() {
      const { t } = useI18n()
      const view = ref('table')
      const options = computed(() => [
        { value: 'table', label: t('projects.filters.tableView'), icon: 'i-lucide-list' },
        { value: 'board', label: t('projects.filters.boardView'), icon: 'i-lucide-layout-grid' },
      ])
      return { view, options }
    },
    template: '<ViewSwitch v-model="view" :options="options" />',
  }),
}
