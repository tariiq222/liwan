import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { sectionTabsUi } from '@nasq/ui/app/utils/sectionTabs'

export default {
  title: 'Nuxt UI/Tabs',
  parameters: { docs: { description: { component: 'تبويبات الأقسام: `UTabs variant="link"` مع `sectionTabsUi` — زوايا حادة وخط سفلي مستقيم، مثل صفّ تبويبات المشروع. تبديل الفلاتر يبقى `pill` بحجم `sm`.' } } },
} satisfies Meta

export const Sections: StoryObj = {
  name: 'تبويبات الأقسام',
  render: () => ({
    setup: () => ({
      ui: sectionTabsUi,
      items: [
        { label: 'التفاصيل', slot: 'details', value: 'details' },
        { label: 'التعليقات', value: 'comments' },
        { label: 'السجل', value: 'log' },
        { label: 'المهام الفرعية', value: 'subtasks' },
        { label: 'المرفقات', value: 'attachments' },
        { label: 'المهام السابقة', value: 'dependencies' },
      ],
    }),
    template: `<UTabs variant="link" :ui="ui" :items="items" default-value="details">
      <template #details><p class="pt-4 text-sm text-muted">محتوى القسم</p></template>
    </UTabs>`,
  }),
}

export const Filter: StoryObj = {
  name: 'تبديل الفلتر',
  render: () => ({
    setup: () => ({ items: [{ label: 'مفتوحة', value: 'open' }, { label: 'مغلقة', value: 'closed' }] }),
    template: '<UTabs :items="items" default-value="open" :content="false" size="sm" class="w-fit" />',
  }),
}
