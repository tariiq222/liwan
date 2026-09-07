<script setup lang="ts">
import type { ProjectDetail } from '@nasq/contracts'
import { CalendarDays, Eye, Tags, UserRound, UsersRound } from '@lucide/vue'
import { formatCalendarDate } from '@/composables/calendarDate'

const props = defineProps<{ project: ProjectDetail }>()
const { t, locale } = useI18n()

function dateLabel(value: string | null) {
  return value ? formatCalendarDate(value, locale.value) : t('projects.settings.noDate')
}
</script>

<template>
  <aside data-testid="project-support-rail" class="grid content-start gap-4">
    <Card class="nasq-panel">
      <CardHeader>
        <CardTitle class="text-base">{{ t('projects.overview.metadata') }}</CardTitle>
      </CardHeader>
      <CardContent class="nasq-metadata p-0">
        <div class="flex items-center justify-between gap-3 px-[18px] py-3">
          <span class="flex items-center gap-2 text-sm text-muted-foreground"><UserRound class="size-4" />{{ t('projects.settings.manager') }}</span>
          <span class="min-w-0 max-w-[60%] break-words text-end text-sm font-medium">{{ project.manager?.name ?? t('projects.settings.noManager') }}</span>
        </div>
        <div class="flex items-center justify-between gap-3 px-[18px] py-3">
          <span class="flex items-center gap-2 text-sm text-muted-foreground"><CalendarDays class="size-4" />{{ t('projects.settings.dateStart') }}</span>
          <span class="text-sm" dir="ltr">{{ dateLabel(project.date_start) }}</span>
        </div>
        <div class="flex items-center justify-between gap-3 px-[18px] py-3">
          <span class="flex items-center gap-2 text-sm text-muted-foreground"><CalendarDays class="size-4" />{{ t('projects.settings.dateEnd') }}</span>
          <span class="text-sm" dir="ltr">{{ dateLabel(project.date_end) }}</span>
        </div>
        <div class="flex items-center justify-between gap-3 px-[18px] py-3">
          <span class="flex items-center gap-2 text-sm text-muted-foreground"><Eye class="size-4" />{{ t('projects.settings.visibility') }}</span>
          <span class="text-sm">{{ t(project.privacy_visibility === 'followers' ? 'projects.settings.visibilityFollowers' : 'projects.settings.visibilityEmployees') }}</span>
        </div>
        <div class="flex items-center justify-between gap-3 px-[18px] py-3">
          <span class="flex items-center gap-2 text-sm text-muted-foreground"><UsersRound class="size-4" />{{ t('projects.overview.followers') }}</span>
          <span class="text-sm tabular-nums">{{ project.followers_count }}</span>
        </div>
        <div class="flex items-start justify-between gap-3 px-[18px] py-3">
          <span class="flex items-center gap-2 text-sm text-muted-foreground"><Tags class="size-4" />{{ t('projects.settings.tags') }}</span>
          <div class="flex min-w-0 max-w-[60%] flex-wrap justify-end gap-1">
            <Badge v-for="tag in project.tags" :key="tag.id" variant="secondary" class="min-w-0 max-w-full"><span class="min-w-0 max-w-full truncate" :title="tag.name">{{ tag.name }}</span></Badge>
            <span v-if="project.tags.length === 0" class="text-sm text-muted-foreground">—</span>
          </div>
        </div>
      </CardContent>
    </Card>
  </aside>
</template>
