<script setup lang="ts">
import type { ProjectUpdate } from '@nasq/contracts'
import { sanitizeHtml } from '@/utils/sanitize'
import { formatCalendarDate } from '@/composables/calendarDate'
import { useProjectUpdates } from '@/composables/useProjectUpdates'
import ProjectStatusBadge from './ProjectStatusBadge.vue'
import ProjectUpdateDialog from './ProjectUpdateDialog.vue'

const props = defineProps<{ projectId: number; canManage: boolean }>()

const { t, locale } = useI18n()
const hydrated = useHydrated()

const projectIdRef = computed(() => props.projectId)
const { data, isLoading } = useProjectUpdates(projectIdRef)
const items = computed<ProjectUpdate[]>(() => data.value ?? [])

// u.date is a YYYY-MM-DD calendar date, not an instant — new Date(iso) parses
// it as UTC midnight and renders a day early west of Greenwich.
function dateLabel(iso: string): string {
  return formatCalendarDate(iso, locale.value)
}

const dialogOpen = ref(false)
</script>

<template>
  <div class="space-y-3">
    <div v-if="canManage" class="flex justify-end">
      <Button data-testid="project-update-new" :disabled="!hydrated" @click="dialogOpen = true">
        {{ t('projects.updates.new') }}
      </Button>
    </div>

    <template v-if="isLoading">
      <Skeleton v-for="n in 3" :key="n" class="h-24 w-full" />
    </template>
    <p v-else-if="items.length === 0" class="text-muted-foreground">{{ t('projects.updates.empty') }}</p>
    <template v-else>
      <Card v-for="u in items" :key="u.id" data-testid="project-update">
        <CardContent class="space-y-2 p-4">
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <ProjectStatusBadge :status="u.status" />
              <span class="font-medium">{{ u.name }}</span>
            </div>
            <span class="shrink-0 text-xs text-muted-foreground">{{ dateLabel(u.date) }}</span>
          </div>
          <p class="text-xs text-muted-foreground">{{ t('projects.updates.by', { name: u.author.name }) }}</p>
          <div class="prose prose-sm max-w-none text-sm break-words" v-html="sanitizeHtml(u.description_html)" />
        </CardContent>
      </Card>
    </template>
  </div>

  <ProjectUpdateDialog :open="dialogOpen" :project-id="projectId" @update:open="(v) => (dialogOpen = v)" />
</template>
