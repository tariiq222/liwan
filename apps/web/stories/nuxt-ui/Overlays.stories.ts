import type { Meta, StoryObj } from '@storybook/vue3-vite'

export default {
  title: 'Nuxt UI/Overlays',
  parameters: { docs: { description: { component: 'وصفات `dropdownMenu` و`tooltip` و`popover` و`slideover` و`modal` وطبقاتها `--webvue-ui-z-menu` و`--webvue-ui-z-sheet`.' } } },
} satisfies Meta

export const Menus: StoryObj = {
  name: 'القوائم والتلميحات',
  render: () => ({
    template: `<div class="flex flex-wrap items-center gap-3">
      <UDropdownMenu :items="[{ label: $t('app.save') }, { label: $t('app.cancel') }, { label: $t('filterCard.clear'), color: 'error' }]">
        <UButton color="neutral" variant="outline" trailing-icon="i-lucide-chevron-down">{{ $t('filterCard.title') }}</UButton>
      </UDropdownMenu>
      <UTooltip :text="$t('app.back')"><UButton color="neutral" variant="ghost" square icon="i-lucide-info" :aria-label="$t('app.back')" /></UTooltip>
      <UPopover><UButton color="neutral" variant="outline">{{ $t('app.search') }}</UButton><template #content><div><UInput icon="i-lucide-search" class="w-full" /></div></template></UPopover>
    </div>`,
  }),
}

export const Sheets: StoryObj = {
  name: 'اللوحات والنوافذ',
  render: () => ({
    template: `<div class="flex flex-wrap items-center gap-3">
      <USlideover :title="$t('filterCard.title')"><UButton color="neutral" variant="outline">USlideover</UButton><template #body><p class="text-sm text-muted">{{ $t('app.noResults') }}</p></template></USlideover>
      <UModal :title="$t('app.unsavedChangesTitle')" :description="$t('app.unsavedChanges')"><UButton color="neutral" variant="outline">UModal</UButton><template #footer><div class="flex w-full justify-end gap-2"><UButton color="neutral" variant="outline">{{ $t('app.stay') }}</UButton><UButton>{{ $t('app.discardAndLeave') }}</UButton></div></template></UModal>
    </div>`,
  }),
}
