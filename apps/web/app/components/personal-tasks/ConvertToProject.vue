<script setup lang="ts">
import { refDebounced } from '@vueuse/core'
import { ApiError } from '@/composables/useApi'
import { useConvertMyTask, useConvertTargets } from '@/composables/useMyTasks'

// Rendered by the page only when `allowed_actions.convert`. Converting is irreversible, so the
// button first opens the inline confirmation; the destination is the server's `href`.
const props = defineProps<{ taskId: number; open: boolean; hasDraft: boolean; pendingElsewhere: boolean; prepareConvert: () => Promise<boolean> }>()
const emit = defineEmits<{ converted: []; close: []; 'resume-writing': []; 'pending-change': [pending: boolean] }>()

const { t } = useI18n()
const hydrated = useHydrated()
const q = ref('')
const search = refDebounced(q, 250)
const { data: targets, isLoading: loadingTargets, error: targetsError, refetch } = useConvertTargets(search, { enabled: () => props.open })
const { mutateAsync: convert, isPending } = useConvertMyTask()

function focusControl() {
  if (!props.open) return
  nextTick(() => document.querySelector<HTMLElement>('[data-testid="my-task-convert"] button[aria-haspopup="listbox"], [data-testid="my-task-convert"] [data-slot="error-state"] button')?.focus())
}
watch([() => props.open, loadingTargets, targetsError], () => { if (!loadingTargets.value) focusControl() }, { flush: 'post' })

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
  if (submitted || projectId.value === null || isPending.value || props.pendingElsewhere) return
  submitted = true
  error.value = ''
  try {
    if (!(await props.prepareConvert())) { submitted = false; return }
    emit('pending-change', true)
    const { href } = await convert({ id: props.taskId, projectId: projectId.value })
    emit('converted')
    await navigateTo(href)
  } catch (e) {
    submitted = false
    confirming.value = false
    error.value = e instanceof ApiError ? e.message : t('myTasks.errors.convert')
  } finally { emit('pending-change', false) }
}
</script>

<template>
  <SharedRecordSection v-if="open" variant="action" data-testid="my-task-convert" :title="t('myTasks.convert.title')" :description="t('myTasks.convert.description')">
    <template #actions><UButton type="button" color="neutral" variant="ghost" icon="i-lucide-x" :aria-label="t('app.close')" :disabled="isPending" @click="emit('close')" /></template>
    <SharedPageState v-if="loadingTargets || targetsError" :loading="loadingTargets" :error="targetsError" @retry="refetch" />
    <SharedEmptyState v-else-if="targets && !targets.total && !q && projectId === null" :title="t('myTasks.convert.empty')" />
    <USelectMenu v-else
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
      :description="hasDraft ? t('myTasks.convert.discardWarning') : undefined"
      :confirm-label="t(hasDraft ? 'myTasks.convert.discardConfirm' : 'myTasks.convert.confirm')"
      :cancel-label="t(hasDraft ? 'myTasks.convert.resume' : 'myTasks.convert.keep')"
      :pending="isPending"
      :disabled="pendingElsewhere"
      @confirm="submit"
      @cancel="confirming = false; if (hasDraft) emit('resume-writing')"
    />
    <div v-else class="flex justify-end">
      <UButton type="button" :disabled="!hydrated || projectId === null || pendingElsewhere || !!targetsError || loadingTargets" :label="t('myTasks.convert.submit')" @click="confirming = true" />
    </div>
    <p v-if="pendingElsewhere" role="status" class="text-sm text-muted">{{ t('myTasks.pendingWork') }}</p>
    <p v-else-if="projectId === null && !targetsError && !loadingTargets" class="text-sm text-muted">{{ t('myTasks.convert.chooseHint') }}</p>
    <p v-if="error" role="alert" class="text-sm text-error">{{ error }}</p>
  </SharedRecordSection>
</template>
