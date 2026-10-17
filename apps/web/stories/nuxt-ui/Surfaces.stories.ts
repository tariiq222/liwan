import type { Meta, StoryObj } from '@storybook/vue3-vite'

export default {
  title: 'Nuxt UI/Surfaces',
  parameters: { docs: { description: { component: '`UCard` و`UTable` بوصفات Nuxt UI الأصلية؛ لا تخصيص.' } } },
} satisfies Meta

export const Card: StoryObj = {
  name: 'البطاقة',
  render: () => ({
    template: `<UCard>
      <template #header><h2 class="text-lg font-semibold text-highlighted">{{ $t('projects.dashboard.charts.statusTitle') }}</h2></template>
      <p class="text-sm text-muted">{{ $t('projects.dashboard.charts.noStatusData') }}</p>
      <template #footer><div class="flex justify-end gap-2"><UButton color="neutral" variant="outline">{{ $t('app.cancel') }}</UButton><UButton>{{ $t('app.save') }}</UButton></div></template>
    </UCard>`,
  }),
}

export const Table: StoryObj = {
  name: 'الجدول',
  render: () => ({
    setup: () => ({
      data: [{ id: 1, name: 'مشروع ألفا', status: 'on_track' }, { id: 2, name: 'تطوير البوابة', status: 'at_risk' }],
      columns: [{ accessorKey: 'id', header: '#' }, { accessorKey: 'name', header: 'Name' }, { accessorKey: 'status', header: 'Status' }],
    }),
    template: '<div class="rounded-card ring ring-default bg-default overflow-hidden"><UTable :data="data" :columns="columns" /></div>',
  }),
}
