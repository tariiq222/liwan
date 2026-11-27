<script setup lang="ts">
/**
 * The call chip in the header, beside the bell (design D3 and section 8).
 *
 * It is not a floating panel over the content: a short chip that stays in the header while the employee moves between
 * pages. Idle it shows the phone; ringing it colours and offers answer and reject; in a call it shows the caller and the
 * duration with a hang-up. Clicking opens the caller card and the in-call controls.
 *
 * The chip draws and nothing else. The phone, its labels and its actions arrive through the `CALL_CHIP` seam that the
 * telephony application provides, so the shell imports no application component and a product without telephony simply
 * has no seam and draws no chip.
 */
const seam = useCallChip()

const labels = computed(() => seam?.labels)
const open = ref(false)
const hydrated = useHydrated()
const seconds = ref(0)
const caller = computed(() => seam?.state.value.remote ?? null)
const raw = computed(() => seam?.state.value.phase ?? 'idle')
// `connecting` and `registered` are both "the phone is ready"; the chip itself has nothing to show for them.
const phase = computed(() => (raw.value === 'registered' || raw.value === 'connecting' ? 'idle' : raw.value))

const label = computed(() => {
  const text = labels.value
  if (!text) return ''
  if (phase.value === 'ringing') return text.ringing(caller.value || '')
  if (phase.value === 'calling') return text.calling(caller.value || '')
  if (phase.value === 'in-call') return text.inCall(durationText.value)
  if (phase.value === 'failed') return text.failed
  return text.idle
})

const durationText = computed(() => {
  const minutes = Math.floor(seconds.value / 60)
  return `${minutes}:${String(seconds.value % 60).padStart(2, '0')}`
})

const tone = computed(() => {
  if (phase.value === 'ringing') return 'warning'
  if (phase.value === 'in-call' || phase.value === 'calling') return 'success'
  if (phase.value === 'failed') return 'danger'
  return 'neutral'
})

let timer: ReturnType<typeof setInterval> | null = null

function startTimer() {
  stopTimer()
  timer = setInterval(() => { seconds.value += 1 }, 1000)
}

function stopTimer() {
  if (timer) clearInterval(timer)
  timer = null
}

function hangUp() {
  stopTimer()
  seconds.value = 0
  open.value = false
  seam?.actions.hangUp()
}

// The duration comes from the phone's own start time when it has one, so a page change does not restart the clock.
watch(() => [raw.value, seam?.state.value.since] as const, ([now, startedAt]) => {
  if (now === 'in-call' && startedAt) {
    seconds.value = Math.max(Math.floor((Date.now() - startedAt) / 1000), 0)
    startTimer()
  }
  else if (now !== 'in-call') {
    stopTimer()
    seconds.value = 0
  }
}, { immediate: true })

onBeforeUnmount(stopTimer)
</script>

<template>
  <div v-if="seam" class="liwan-call-chip" role="group" :aria-label="labels?.label">
    <UPopover v-model:open="open" :disabled="phase === 'idle'" :content="{ align: 'end' }">
      <UButton
        :color="tone === 'danger' ? 'error' : tone === 'warning' ? 'warning' : tone === 'success' ? 'success' : 'neutral'"
        :variant="phase === 'idle' ? 'ghost' : 'solid'"
        size="sm"
        icon="i-lucide-phone"
        :aria-label="label"
        :disabled="!hydrated"
        :data-phase="phase"
        data-testid="telephony-call-chip"
      >
        <span class="tabular-nums" dir="ltr">{{ label }}</span>
      </UButton>
      <template #content>
        <div class="grid w-64 gap-(--liwan-gap-card) p-(--liwan-card-pad)">
          <p class="text-sm font-semibold">{{ labels?.callerCard }}</p>
          <p class="text-sm" dir="ltr">{{ caller || '—' }}</p>
          <p v-if="phase === 'in-call'" class="text-sm tabular-nums" dir="ltr">{{ durationText }}</p>
          <div class="flex flex-wrap gap-2">
            <UButton
              v-if="phase === 'ringing'"
              size="sm"
              icon="i-lucide-phone-incoming"
              @click="seam?.actions.answer()"
            >
              {{ labels?.answer }}
            </UButton>
            <UButton
              v-if="phase === 'ringing'"
              size="sm"
              color="error"
              variant="outline"
              icon="i-lucide-phone-off"
              @click="hangUp"
            >
              {{ labels?.reject }}
            </UButton>
            <UButton
              v-if="phase === 'in-call' || phase === 'calling'"
              size="sm"
              color="error"
              icon="i-lucide-phone-off"
              @click="hangUp"
            >
              {{ labels?.hangUp }}
            </UButton>
          </div>
          <p v-if="phase === 'failed'" class="text-sm text-muted">{{ labels?.failedHint }}</p>
        </div>
      </template>
    </UPopover>
  </div>
</template>
