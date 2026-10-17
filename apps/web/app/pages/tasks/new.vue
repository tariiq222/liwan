<script setup lang="ts">
import TaskCreateForm from '@/components/pmo/tasks/TaskCreateForm.vue'
import { usePersonalStages } from '@/composables/usePersonalStages'
import { owningListBack } from '@/utils/recordListOrigin'
import { parseTaskCreatePreset } from '@/utils/taskCreatePolicy'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const toast = useToast()
const hydrated = useHydrated()
const sourcePaths = useRecordListPaths(['/tasks'])
const returnTo = computed(() => router.resolve(owningListBack(route.query, sourcePaths.value, route.hash)).fullPath)
const { data: personalStages } = usePersonalStages()
const preset = computed(() => parseTaskCreatePreset(route.query, 'personal', (personalStages.value ?? []).map(stage => stage.id)))
function created(id: number) {
  toast.add({ title: t('tasks.created'), color: 'success' })
  router.replace({ path: '/tasks/' + id, query: { returnTo: returnTo.value } })
}
</script>

<template>
  <SharedCreatePanel :title="t('tasks.new')" :back-to="returnTo">
    <TaskCreateForm mode="project" :preset="preset" @created="created" @cancel="router.push(returnTo)" />
    <p v-if="!hydrated" class="sr-only">{{ t('tasks.loading') }}</p>
  </SharedCreatePanel>
</template>
