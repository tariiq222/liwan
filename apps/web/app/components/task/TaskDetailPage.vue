<script setup lang="ts">
import { ArrowLeft, ArrowRight } from 'lucide-vue-next'
import type { RouteLocationRaw } from 'vue-router'
import type { TaskListParams } from '@/composables/useTasks'
import TaskDetailPanel from './TaskDetailPanel.vue'

const props = defineProps<{
  taskId: number
  basePath?: string
  closeTo?: RouteLocationRaw
  siblingParams?: TaskListParams
  backLabel?: string
}>()

const route = useRoute()
const router = useRouter()
const { t, localeProperties } = useI18n()

const isRtl = computed(() => localeProperties.value.dir === 'rtl')

function close() {
  router.push(props.closeTo ?? { path: '/tasks', query: route.query })
}
</script>

<template>
  <section data-testid="task-detail-page" class="mx-auto flex min-h-[calc(100vh-7rem)] w-full max-w-[1440px] flex-col gap-4">
    <nav class="flex items-center justify-between gap-3" :aria-label="t('tasks.detail.navigation')">
      <Button variant="ghost" size="sm" class="gap-2 px-2 text-muted-foreground" type="button" @click="close">
        <component :is="isRtl ? ArrowRight : ArrowLeft" class="size-4" />
        {{ props.backLabel ?? t('tasks.detail.back') }}
      </Button>
      <span class="text-xs text-muted-foreground">{{ t('tasks.detail.pageLabel') }}</span>
    </nav>

    <div class="min-h-0 flex-1 overflow-hidden rounded-xl border bg-card shadow-sm">
      <TaskDetailPanel :task-id="props.taskId" :base-path="props.basePath" :sibling-params="props.siblingParams" @close="close" />
    </div>
  </section>
</template>
