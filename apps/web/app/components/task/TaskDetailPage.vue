<script setup lang="ts">
import { ArrowLeft, ArrowRight } from 'lucide-vue-next'
import type { RouteLocationRaw } from 'vue-router'
import type { TaskListParams } from '@/composables/useTasks'
import TaskDetailPanel from './TaskDetailPanel.vue'
import PageHeader from '@/components/shared/PageHeader.vue'

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
const hydrated = useHydrated()
const backTo = computed(() => props.closeTo ?? { path: '/tasks', query: route.query })

function close() {
  if (!hydrated.value) return
  router.push(backTo.value)
}
</script>

<template>
  <section data-testid="task-detail-page" class="mx-auto flex min-h-[calc(100vh-7rem)] w-full max-w-[1440px] flex-col gap-4">
    <PageHeader :title="t('tasks.detail.pageLabel')">
      <template #back>
        <NuxtLink
          :to="backTo"
          class="inline-flex items-center gap-2 px-2 text-sm text-muted-foreground hover:text-foreground"
          :aria-label="props.backLabel ?? t('tasks.detail.back')"
          :tabindex="hydrated ? undefined : -1"
          @click="!hydrated && $event.preventDefault()"
        >
          <component :is="isRtl ? ArrowRight : ArrowLeft" class="size-4" />
          {{ props.backLabel ?? t('tasks.detail.back') }}
        </NuxtLink>
      </template>
    </PageHeader>

    <div class="min-h-0 flex-1 overflow-hidden rounded-xl border bg-card shadow-sm">
      <TaskDetailPanel :task-id="props.taskId" :base-path="props.basePath" :sibling-params="props.siblingParams" @close="close" />
    </div>
  </section>
</template>
