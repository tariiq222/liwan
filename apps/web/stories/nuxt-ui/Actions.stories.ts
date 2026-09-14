import type { Meta, StoryObj } from '@storybook/vue3-vite'

export default {
  title: 'Nuxt UI/Actions',
  parameters: { docs: { description: { component: 'وصفات `button` و`badge` و`progress` من `apps/web/app/app.config.ts`. الرتب: أساسي واحد solid، محايد outline للإلغاء والرجوع، ghost ثالثي، error للحذف.' } } },
} satisfies Meta

export const ButtonRanks: StoryObj = {
  name: 'رتب الأزرار',
  render: () => ({
    template: `<div class="space-y-4">
      <div class="flex flex-wrap items-center gap-3">
        <UButton icon="i-lucide-plus">{{ $t('tasks.new') }}</UButton>
        <UButton color="neutral" variant="outline">{{ $t('app.cancel') }}</UButton>
        <UButton color="neutral" variant="ghost">{{ $t('app.back') }}</UButton>
        <UButton color="primary" variant="outline">{{ $t('app.save') }}</UButton>
        <UButton color="error" variant="ghost" square icon="i-lucide-trash-2" :aria-label="$t('filterCard.clear')" />
        <UButton color="neutral" variant="outline" square icon="i-lucide-list-filter" :aria-label="$t('filterCard.title')" />
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <UButton disabled>{{ $t('app.save') }}</UButton>
        <UButton loading>{{ $t('app.save') }}</UButton>
        <UButton size="sm" color="primary" variant="outline">{{ $t('app.retry') }}</UButton>
      </div>
    </div>`,
  }),
}

export const BadgesAndProgress: StoryObj = {
  name: 'الشارات والتقدم',
  render: () => ({
    template: `<div class="space-y-4">
      <div class="flex flex-wrap items-center gap-2">
        <UBadge>{{ $t('projects.status.on_track') }}</UBadge>
        <UBadge color="neutral" variant="subtle">{{ $t('projects.status.on_hold') }}</UBadge>
        <UBadge color="warning" variant="subtle">{{ $t('projects.status.at_risk') }}</UBadge>
        <UBadge color="error" variant="subtle">{{ $t('projects.status.off_track') }}</UBadge>
        <UBadge color="success" variant="subtle">{{ $t('projects.status.done') }}</UBadge>
        <UBadge color="primary">3</UBadge>
      </div>
      <UProgress :model-value="45" />
      <UProgress :model-value="100" color="success" />
    </div>`,
  }),
}
