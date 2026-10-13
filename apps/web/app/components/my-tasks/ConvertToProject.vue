<script setup lang="ts">
import { refDebounced } from '@vueuse/core'
import { ApiError } from '@/composables/useApi'
import { useConvertMyTask, useConvertTargets } from '@/composables/useMyTasks'

// Rendered by the page only when `allowed_actions.convert`. Converting is irreversible, so the
// button first opens the inline confirmation; the destination is the server's `href`.
const props = defineProps<{ taskId: number }>()
const emit = defineEmits<{ converted: [] }>()

const { t } = useI18n()
const hydrated = useHydrated()
const q = ref('')
const search = refDebounced(q, 250)
const { data: targets } = useConvertTargets(search)
const { mutateAsync: convert, isPending } = useConvertMyTask()

const projectId = ref<number | null>(null)
const known = ref(new Map<number, string>())
const confirming = ref(false)
const error = ref('')

watch(targets, (value) => {
  const next = new Map(known.value)
  for (const project of value?.items ?? []) next.set(project.id, project.name)
  known.value = next
}, { immediate: true })

const items = computed(() => {
  const rows = (targets.value?.items ?? []).map(project => ({ label: project.name, value: project.id }))
  if (projectId.value !== null && !rows.some(row => row.value === projectId.value)) {
    rows.unshift({ label: known.value.get(projectId.value) ?? `#${projectId.value}`, value: projectId.value })
  }
  return rows
})

function choose(value: unknown) {
  projectId.value = typeof value === 'number' ? value : null
  confirming.value = false
  error.value = ''
}

// Set before the first await and kept after a success: the task is gone once converted, so a
// second submit while the page leaves could only fail.
let submitted = false

async function submit() {
  if (submitted || projectId.value === null || isPending.value) return
  submitted = true
  error.value = ''
  try {
    const { href } = await convert({ id: props.taskId, projectId: projectId.value })
    emit('converted')
    await navigateTo(href)
  } catch (e) {
    submitted = false
    confirming.value = false
    error.value = e instanceof ApiError ? e.message : t('myTasks.errors.convert')
  }
}
</script>

<template>
  <section data-testid="my-task-convert" class="space-y-3" :aria-label="t('myTasks.convert.title')">
    <h2 class="text-lg font-semibold text-highlighted">{{ t('myTasks.convert.title') }}</h2>
    <p class="text-sm text-muted">{{ t('myTasks.convert.description') }}</p>
    <USelectMenu
      v-model:search-term="q"
      :model-value="projectId ?? undefined"
      :items="items"
      value-key="value"
      :ignore-filter="true"
      :placeholder="t('myTasks.convert.choose')"
      :search-input="{ placeholder: t('myTasks.convert.search') }"
      :aria-label="t('myTasks.convert.project')"
      :disabled="!hydrated || isPending"
      class="w-full"
      @update:model-value="choose"
    >
      <template #empty>{{ t('myTasks.convert.empty') }}</template>
    </USelectMenu>
    <SharedInlineConfirm
      v-if="confirming"
      :title="t('myTasks.convert.irreversible')"
      :confirm-label="t('myTasks.convert.confirm')"
      :cancel-label="t('myTasks.convert.keep')"
      :pending="isPending"
      @confirm="submit"
      @cancel="confirming = false"
    />
    <div v-else class="flex justify-end">
      <UButton type="button" :disabled="!hydrated || projectId === null" :label="t('myTasks.convert.submit')" @click="confirming = true" />
    </div>
    <p v-if="error" role="alert" class="text-sm text-error">{{ error }}</p>
  </section>
</template>
