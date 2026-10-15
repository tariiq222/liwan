<script setup lang="ts">
import { useQueryClient } from '@tanstack/vue-query'
import type { ProjectDetail, ProjectPhase } from '@nasq/contracts'
import { ApiError } from '@/composables/useApi'
import { projectKeys } from '@/composables/projectKeys'
import { PHASE_LABEL_KEY, canMoveForward, gateCheckRows, phaseErrorKey } from '@/composables/projectPhase'
import { useMoveProjectPhase } from '@/composables/useProjects'

// The gate into the next phase: what it asks, a fix link per unmet check, and the
// move / step-back actions (managers only). The detail cache is replaced by the
// mutation, so the page re-renders from the new project and no emits are needed.
const props = defineProps<{ project: ProjectDetail }>()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const qc = useQueryClient()
const { mutateAsync: move, isPending } = useMoveProjectPhase()

const state = computed(() => props.project.phase_state)
const rows = computed(() => gateCheckRows(props.project.id, state.value.next_checks))
const canManage = computed(() => props.project.can_manage)
const canAdvance = computed(() => canMoveForward(state.value, canManage.value))
const isClosed = computed(() => state.value.current === 'closed')
const phaseLabel = (phase: ProjectPhase) => t(PHASE_LABEL_KEY[phase])
const stepBack = ref(false)

async function run(phase: ProjectPhase) {
  if (!hydrated.value || isPending.value) return
  try {
    await move({ id: props.project.id, phase, expected: props.project.updated_at })
    stepBack.value = false
  } catch (error) {
    stepBack.value = false
    const stale = error instanceof ApiError && error.status === 409 && error.code === 'stale_write'
    toast.add({
      title: stale ? t('projects.phase.stale') : t(phaseErrorKey(error instanceof ApiError ? error.status : undefined, error instanceof ApiError ? error.code : undefined)),
      color: stale ? 'warning' : 'error',
    })
    // A refused gate or a stale token both mean the cached checks are out of date.
    void qc.invalidateQueries({ queryKey: projectKeys.detail(props.project.id) })
  }
}
</script>

<template>
  <section class="nasq-print-hide flex flex-col gap-3 rounded-lg border border-default p-4" data-testid="project-phase-gate">
    <p v-if="isClosed" class="font-medium text-highlighted" data-testid="project-phase-closed">{{ t('projects.phase.closedNotice') }}</p>
    <template v-else-if="state.next">
      <h2 class="text-base font-semibold text-highlighted">{{ t('projects.phase.gateTitle', { phase: phaseLabel(state.next) }) }}</h2>
      <ul v-if="rows.length" class="flex flex-col gap-2" data-testid="project-phase-checks">
        <li v-for="row in rows" :key="row.key" class="flex flex-wrap items-center gap-2 text-sm" :data-testid="`project-phase-check-${row.key}`" :data-ok="row.ok">
          <UIcon :name="row.ok ? 'i-lucide-circle-check' : 'i-lucide-circle-x'" class="size-4.5" :class="row.ok ? 'text-success' : 'text-error'" aria-hidden="true" />
          <span class="sr-only">{{ row.ok ? t('projects.phase.met') : t('projects.phase.unmet') }}: </span>
          <span>{{ t(row.labelKey) }}</span>
          <UButton v-if="!row.ok && row.fixTo && canManage" :to="row.fixTo" variant="link" size="xs" :label="t('projects.phase.fix')" data-testid="project-phase-fix" />
        </li>
      </ul>
    </template>
    <SharedInlineConfirm
      v-if="canManage && stepBack && state.previous"
      color="warning"
      data-testid="project-phase-back-confirm"
      :title="t('projects.phase.backConfirm', { phase: phaseLabel(state.previous) })"
      :confirm-label="t('projects.phase.backTo', { phase: phaseLabel(state.previous) })"
      :pending="isPending"
      @cancel="stepBack = false"
      @confirm="run(state.previous)"
    />
    <div v-else-if="canManage" class="flex flex-wrap gap-2">
      <UButton v-if="state.next" type="button" data-testid="project-phase-move" :disabled="!hydrated || !canAdvance" :loading="isPending" :label="t('projects.phase.moveTo', { phase: phaseLabel(state.next) })" @click="run(state.next)" />
      <UButton v-if="state.previous" type="button" color="neutral" variant="outline" data-testid="project-phase-back" :disabled="!hydrated || isPending" :label="t('projects.phase.backTo', { phase: phaseLabel(state.previous) })" @click="stepBack = true" />
    </div>
  </section>
</template>
