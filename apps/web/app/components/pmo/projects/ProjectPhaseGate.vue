<script setup lang="ts">
import type { ProjectDetail, ProjectPhase } from '@liwan/contracts'
import { PHASE_LABEL_KEY, canMoveForward, gateCheckRows, isGateAction, isGateCardVisible, isWarningGate, phaseFailure, unmetWarnings } from '@/composables/projectPhase'
import { useMoveProjectPhase } from '@/composables/useProjects'

// The gate into the next phase: what it asks, a fix link per unmet check, and the
// move / step-back actions (managers only). The detail cache is replaced by the
// mutation, so the page re-renders from the new project and no emits are needed.
const props = defineProps<{ project: ProjectDetail }>()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const { mutateAsync: move, isPending } = useMoveProjectPhase()

const state = computed(() => props.project.phase_state)
const rows = computed(() => gateCheckRows(props.project.id, state.value.next_checks))
const canManage = computed(() => props.project.can_manage)
const canAdvance = computed(() => canMoveForward(state.value, canManage.value))
const isClosed = computed(() => state.value.current === 'closed')
const isVisible = computed(() => isGateCardVisible(state.value, canManage.value, props.project.active))
const isAction = computed(() => isGateAction(state.value, canManage.value, props.project.active))
const phaseLabel = (phase: ProjectPhase) => t(PHASE_LABEL_KEY[phase])
const stepBack = ref(false)
// Moving on with an unmet warning check (closing with open tasks) asks the manager to confirm first.
const confirmWarning = ref(false)
const warnings = computed(() => unmetWarnings(state.value.next_checks))

function onMoveForward(phase: ProjectPhase) {
  if (warnings.value.length) confirmWarning.value = true
  else void run(phase)
}

async function run(phase: ProjectPhase, acknowledgeWarnings = false) {
  if (!hydrated.value || isPending.value) return
  try {
    await move({ id: props.project.id, phase, expected: props.project.updated_at, acknowledgeWarnings })
    stepBack.value = false
    confirmWarning.value = false
    toast.add({ title: t('projects.toast.phaseMoved'), color: 'success' })
  } catch (error) {
    stepBack.value = false
    // The server found warnings the cached card did not show: ask now, then resend acknowledged.
    if (!acknowledgeWarnings && isWarningGate(error)) { confirmWarning.value = true; return }
    confirmWarning.value = false
    const { key, color } = phaseFailure(error)
    toast.add({ title: t(key), color })
  }
}
</script>

<template>
  <SharedRecordSection
    v-if="isVisible"
    :variant="isAction ? 'action' : 'tinted'"
    :title="!isClosed && state.next ? t('projects.phase.gateTitle', { phase: phaseLabel(state.next) }) : undefined"
    class="liwan-print-hide"
    data-testid="project-phase-gate"
  >
    <div class="flex flex-col gap-(--liwan-gap-card)">
      <p v-if="isClosed" class="font-medium text-highlighted" data-testid="project-phase-closed-notice">{{ t('projects.phase.closedNotice') }}</p>
      <ul v-else-if="rows.length" class="flex flex-col gap-2" data-testid="project-phase-checks">
        <li v-for="row in rows" :key="row.key" class="flex flex-wrap items-center gap-2 text-sm" :data-testid="`project-phase-check-${row.key}`" :data-ok="row.ok">
          <UIcon :name="row.ok ? 'i-lucide-circle-check' : 'i-lucide-circle-x'" class="size-4.5" :class="row.ok ? 'text-success' : 'text-error'" aria-hidden="true" />
          <span class="sr-only">{{ row.ok ? t('projects.phase.met') : t('projects.phase.unmet') }}: </span>
          <span>{{ t(row.labelKey) }}</span>
          <UButton v-if="!row.ok && row.fixTo && canManage" :to="row.fixTo" variant="link" size="xs" :label="t('projects.phase.fix')" data-testid="project-phase-fix" />
        </li>
      </ul>
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
      <SharedInlineConfirm
        v-else-if="canManage && confirmWarning && state.next"
        color="warning"
        data-testid="project-phase-warning-confirm"
        :title="t('projects.phase.warningConfirm', { phase: phaseLabel(state.next) })"
        :description="warnings.map(check => t(gateCheckRows(project.id, [check])[0]!.labelKey)).join('، ') || t('projects.phase.warningFallback')"
        :confirm-label="t('projects.phase.moveAnyway', { phase: phaseLabel(state.next) })"
        :pending="isPending"
        @cancel="confirmWarning = false"
        @confirm="run(state.next, true)"
      />
      <div v-else-if="canManage" class="flex flex-wrap gap-2">
        <UButton v-if="state.next" type="button" data-testid="project-phase-move" :disabled="!hydrated || !canAdvance" :loading="isPending" :label="t('projects.phase.moveTo', { phase: phaseLabel(state.next) })" @click="onMoveForward(state.next)" />
        <UButton v-if="state.previous" type="button" color="neutral" variant="outline" data-testid="project-phase-back" :disabled="!hydrated || isPending" :label="t('projects.phase.backTo', { phase: phaseLabel(state.previous) })" @click="stepBack = true" />
      </div>
    </div>
  </SharedRecordSection>
</template>
