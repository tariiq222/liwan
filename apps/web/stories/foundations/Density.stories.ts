import type { Meta, StoryObj } from '@storybook/vue3-vite'

export default { title: 'Foundations/Density' } satisfies Meta

export const Controls: StoryObj = {
  name: 'الحقول والأزرار',
  render: () => ({
    template: `
      <div class="flex flex-wrap items-center gap-2 p-4" data-testid="density-controls">
        <UButton data-testid="density-button">حفظ</UButton>
        <UButton color="neutral" variant="outline">إلغاء</UButton>
        <UButton size="xs" data-testid="density-button-xs">صغير</UButton>
        <UButton size="sm" data-testid="density-button-sm">متوسط</UButton>
        <UButton square icon="i-lucide-plus" aria-label="إضافة" data-testid="density-button-icon" />
        <UInput data-testid="density-input" placeholder="بحث" />
        <USelect :items="['أ', 'ب']" model-value="أ" aria-label="الخيار" />
        <UBadge data-testid="density-badge">قيد التنفيذ</UBadge>
        <span class="inline-flex items-center rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground" data-testid="density-tag">جديد</span>
      </div>`,
  }),
}

export const Table: StoryObj = {
  name: 'الجدول',
  render: () => ({
    setup: () => ({
      rows: [
        { name: 'مشروع البوابة', owner: 'سارة', due: '2026-11-02' },
        { name: 'تحديث الأنظمة', owner: 'خالد', due: '2026-11-15' },
        { name: 'Onboarding', owner: 'Lina', due: '2026-12-01' },
      ],
    }),
    template: '<div class="p-4"><UCard data-testid="density-card"><template #header>المشاريع</template><UTable :data="rows" data-testid="density-table" /></UCard></div>',
  }),
}
