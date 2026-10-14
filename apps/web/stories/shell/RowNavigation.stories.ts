import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRowNavigation } from '../../app/composables/useRowNavigation'
import { projectRefs } from '../fixtures/pmo'

// No component: the J / K contract (data-shortcut-row + useRowNavigation) that Plan 4's DataTable wires.
const meta = {
  title: 'Shell/RowNavigation',
  parameters: { layout: 'padded', docs: { description: { component: 'J / K تنقل بين الصفوف الموسومة `data-shortcut-row`، وEnter يفتح رابط الصف.' } } },
} satisfies Meta
export default meta

export const Demo: StoryObj = {
  name: 'تنقل الصفوف بـ J و K',
  render: () => ({
    setup() {
      const list = ref<HTMLElement | null>(null)
      useRowNavigation(list)
      return { list, rows: projectRefs, t: useI18n().t }
    },
    template: `<ul ref="list" class="max-w-md divide-y divide-default rounded-lg ring ring-default" :aria-label="t('nav.projects')">
      <li v-for="row in rows" :key="row.id" data-shortcut-row tabindex="-1" class="px-3 py-2 outline-none focus-visible:bg-elevated focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
        <a :href="'#project-' + row.id" class="text-highlighted">{{ row.name }}</a>
      </li>
    </ul>`,
  }),
}
