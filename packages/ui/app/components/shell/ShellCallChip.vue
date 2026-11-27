<script setup lang="ts">
import { computed, onBeforeUnmount, ref, unref, watch } from 'vue'
import { useCallChip } from '../../composables/useCallChip'

/**
 * The call chip in the header, beside the bell (design D3 and section 8).
 *
 * It is not a floating panel over the content: a compact chip that stays in the header while the employee moves
 * between pages. Idle it shows a phone button that opens the dialpad (or a quiet no-extension notice); ringing it
 * tints warm and offers direct Answer and Reject buttons on the chip; calling/in-call it tints green with caller name
 * or LTR number, tabular duration, and a direct Hang-up button. Clicking the chip opens the caller card and full
 * in-call controls (mute, hold, blind transfer, DTMF keypad).
 *
 * The chip draws and nothing else. State, actions and translated labels arrive through the `CALL_CHIP` seam provided
 * by the telephony application, so the shell imports no application code (UI1, R3).
 */
const props = defineProps<{ defaultOpen?: boolean }>()

const DIAL_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'] as const

const seamRef = useCallChip()
const activeSeam = computed(() => seamRef.value)
const state = computed(() => activeSeam.value?.state.value ?? null)
const labels = computed(() => (activeSeam.value ? unref(activeSeam.value.labels) : null))

const hydrated = useHydrated()
const open = ref(Boolean(props.defaultOpen))
const seconds = ref(0)

const dialNumber = ref('')
const dialError = ref<string | null>(null)
const showTransfer = ref(false)
const transferTarget = ref('')
const transferValidationError = ref<string | null>(null)
const showKeypad = ref(false)
const dtmfTrail = ref('')

const rawPhase = computed(() => state.value?.phase ?? 'idle')
// `connecting` and `registered` both present as idle on the chip.
const phase = computed(() => (rawPhase.value === 'registered' || rawPhase.value === 'connecting' ? 'idle' : rawPhase.value))
const isActiveCall = computed(() => phase.value === 'ringing' || phase.value === 'calling' || phase.value === 'in-call')
const isInCall = computed(() => phase.value === 'in-call')

const callerNumber = computed(() => state.value?.callerCard?.number ?? state.value?.remote ?? null)
const partnerName = computed(() => state.value?.callerCard?.partnerName ?? null)
const displayParty = computed(() => {
  if (phase.value === 'failed') return labels.value?.failed ?? ''
  return partnerName.value || callerNumber.value || labels.value?.unknownCaller || ''
})
const displayPartyIsNumber = computed(() => phase.value !== 'failed' && !partnerName.value && Boolean(callerNumber.value))

const durationText = computed(() => {
  const minutes = Math.floor(seconds.value / 60)
  return `${minutes}:${String(seconds.value % 60).padStart(2, '0')}`
})

const triggerColor = computed(() => {
  if (phase.value === 'ringing') return 'warning'
  if (phase.value === 'calling' || phase.value === 'in-call') return 'success'
  if (phase.value === 'failed') return 'error'
  return 'neutral'
})

const triggerIcon = computed(() => {
  if (phase.value === 'ringing') return 'i-lucide-phone-incoming'
  if (phase.value === 'calling' || phase.value === 'in-call') return 'i-lucide-phone-call'
  if (phase.value === 'failed') return 'i-lucide-phone-off'
  return 'i-lucide-phone'
})

const wrapperClass = computed(() => {
  if (phase.value === 'ringing') return 'border border-warning/40 bg-warning/10 pe-1'
  if (phase.value === 'calling' || phase.value === 'in-call') return 'border border-success/40 bg-success/10 pe-1'
  if (phase.value === 'failed') return 'border border-error/40 bg-error/10'
  return ''
})

const triggerAriaLabel = computed(() => {
  const text = labels.value
  if (!text) return ''
  if (phase.value === 'ringing') return text.ringing(displayParty.value)
  if (phase.value === 'calling') return text.calling(displayParty.value)
  if (phase.value === 'in-call') return text.inCall(durationText.value)
  if (phase.value === 'failed') return text.failed
  return text.idle
})

const activeTransferError = computed(() => transferValidationError.value || state.value?.transferError || null)

let timer: ReturnType<typeof setInterval> | null = null

function startTimer() {
  stopTimer()
  timer = setInterval(() => { seconds.value += 1 }, 1000)
}

function stopTimer() {
  if (timer) clearInterval(timer)
  timer = null
}

function answer() {
  activeSeam.value?.actions.answer()
}

function reject() {
  stopTimer()
  seconds.value = 0
  open.value = false
  activeSeam.value?.actions.reject()
}

function hangUp() {
  stopTimer()
  seconds.value = 0
  open.value = false
  activeSeam.value?.actions.hangUp()
}

function appendDial(key: string) {
  dialError.value = null
  dialNumber.value += key
}

function backspaceDial() {
  dialError.value = null
  dialNumber.value = dialNumber.value.slice(0, -1)
}

function submitDial() {
  const seam = activeSeam.value
  if (!seam || !dialNumber.value.trim()) return
  const error = seam.actions.call(dialNumber.value)
  if (error) {
    dialError.value = error
    return
  }
  dialError.value = null
  dialNumber.value = ''
}

function toggleTransferPanel() {
  showTransfer.value = !showTransfer.value
  transferValidationError.value = null
  if (showTransfer.value) showKeypad.value = false
}

function toggleKeypadPanel() {
  showKeypad.value = !showKeypad.value
  if (showKeypad.value) showTransfer.value = false
}

function submitTransfer() {
  const seam = activeSeam.value
  if (!seam || !transferTarget.value.trim()) return
  const error = seam.actions.transfer(transferTarget.value)
  if (error) {
    transferValidationError.value = error
    return
  }
  transferValidationError.value = null
  transferTarget.value = ''
}

function pressDtmf(digit: string) {
  dtmfTrail.value += digit
  activeSeam.value?.actions.sendDtmf(digit)
}

function retry() {
  activeSeam.value?.actions.retry()
}

watch(dialNumber, () => {
  dialError.value = null
})

watch(transferTarget, () => {
  transferValidationError.value = null
})

// The duration comes from the phone's own start time when it has one, so a page change does not restart the clock.
watch(() => [rawPhase.value, state.value?.since] as const, ([now, startedAt]) => {
  if (now === 'in-call' && startedAt) {
    seconds.value = Math.max(Math.floor((Date.now() - startedAt) / 1000), 0)
    startTimer()
  } else if (now !== 'in-call') {
    stopTimer()
    seconds.value = 0
  }
  if (now !== 'in-call') {
    showTransfer.value = false
    showKeypad.value = false
    transferTarget.value = ''
    transferValidationError.value = null
    dtmfTrail.value = ''
  }
}, { immediate: true })

onBeforeUnmount(stopTimer)
</script>

<template>
  <div
    v-if="activeSeam && state && labels"
    class="liwan-call-chip inline-flex items-center gap-1 rounded-control"
    :class="wrapperClass"
    role="group"
    :aria-label="labels.label"
    :data-phase="phase"
  >
    <UPopover v-model:open="open" :content="{ align: 'end' }">
      <UButton
        :color="triggerColor"
        :variant="phase === 'idle' ? 'outline' : 'ghost'"
        size="sm"
        :icon="triggerIcon"
        :aria-label="triggerAriaLabel"
        :disabled="!hydrated"
        :data-phase="phase"
        class="h-10 rounded-control"
        data-testid="telephony-call-chip"
      >
        <template v-if="phase !== 'idle'">
          <span class="max-w-36 truncate font-medium">
            <bdi :dir="displayPartyIsNumber ? 'ltr' : 'auto'">{{ displayParty }}</bdi>
          </span>
          <span
            v-if="isInCall"
            class="ms-1.5 font-semibold tabular-nums"
            dir="ltr"
            data-testid="telephony-chip-duration"
          >
            {{ durationText }}
          </span>
        </template>
      </UButton>

      <template #content>
        <div class="grid w-80 gap-3 p-4">
          <!-- Active call: caller card + controls -->
          <template v-if="isActiveCall">
            <div class="grid gap-1.5" data-testid="telephony-caller-card">
              <div class="flex items-center justify-between gap-2">
                <p class="text-xs font-semibold text-muted">{{ labels.callerCard }}</p>
                <span v-if="isInCall" class="text-xs font-semibold tabular-nums text-success" dir="ltr">
                  {{ durationText }}
                </span>
              </div>

              <p v-if="state.callerCardLoading" class="text-xs text-muted" data-testid="telephony-caller-loading">
                {{ labels.loadingCaller }}
              </p>

              <div class="grid gap-0.5">
                <p class="truncate text-sm font-semibold text-highlighted" data-testid="telephony-caller-name">
                  <bdi>{{ partnerName || labels.unknownCaller }}</bdi>
                </p>
                <p v-if="state.callerCard?.companyName" class="truncate text-xs text-muted" data-testid="telephony-caller-company">
                  <bdi>{{ state.callerCard.companyName }}</bdi>
                </p>
                <p v-if="callerNumber" class="text-xs text-muted tabular-nums" dir="ltr" data-testid="telephony-caller-number">
                  {{ callerNumber }}
                </p>
              </div>

              <NuxtLink
                v-if="!partnerName && state.callerCard?.saveContactTo"
                :to="state.callerCard.saveContactTo"
                class="inline-flex w-fit items-center gap-1.5 rounded-inner text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                data-testid="telephony-save-contact"
                @click="open = false"
              >
                <UIcon name="i-lucide-user-plus" class="size-3.5" aria-hidden="true" />
                <span>{{ labels.saveContact }}</span>
              </NuxtLink>

              <div v-if="state.callerCard?.recentCalls.length" class="mt-1 border-t border-default pt-2">
                <p class="mb-1 text-xs font-medium text-muted">{{ labels.recentCalls }}</p>
                <ul class="divide-y divide-default text-xs" data-testid="telephony-recent-calls">
                  <li
                    v-for="recent in state.callerCard.recentCalls"
                    :key="recent.id"
                    class="flex items-center justify-between gap-2 py-1"
                  >
                    <span class="truncate text-highlighted">{{ recent.direction }} · {{ recent.state }}</span>
                    <span class="flex shrink-0 items-center gap-1.5 text-muted tabular-nums" dir="ltr">
                      <span v-if="recent.time">{{ recent.time }}</span>
                      <span v-if="recent.duration">{{ recent.duration }}</span>
                    </span>
                  </li>
                </ul>
              </div>
            </div>

            <!-- In-call controls (mute, hold, blind transfer, DTMF) -->
            <div v-if="isInCall" class="grid gap-2 border-t border-default pt-3">
              <div class="grid grid-cols-2 gap-1.5">
                <UButton
                  size="sm"
                  :color="state.muted ? 'warning' : 'neutral'"
                  :variant="state.muted ? 'soft' : 'outline'"
                  :icon="state.muted ? 'i-lucide-mic-off' : 'i-lucide-mic'"
                  :disabled="!hydrated"
                  class="justify-center rounded-control"
                  data-testid="telephony-mute"
                  @click="activeSeam.actions.toggleMute()"
                >
                  {{ state.muted ? labels.unmute : labels.mute }}
                </UButton>
                <UButton
                  size="sm"
                  :color="state.held ? 'warning' : 'neutral'"
                  :variant="state.held ? 'soft' : 'outline'"
                  :icon="state.held ? 'i-lucide-play' : 'i-lucide-pause'"
                  :disabled="!hydrated"
                  class="justify-center rounded-control"
                  data-testid="telephony-hold"
                  @click="activeSeam.actions.toggleHold()"
                >
                  {{ state.held ? labels.resume : labels.hold }}
                </UButton>
                <UButton
                  size="sm"
                  :color="showTransfer ? 'primary' : 'neutral'"
                  :variant="showTransfer ? 'soft' : 'outline'"
                  icon="i-lucide-phone-forwarded"
                  :disabled="!hydrated"
                  class="justify-center rounded-control"
                  data-testid="telephony-transfer-toggle"
                  @click="toggleTransferPanel"
                >
                  {{ labels.transfer }}
                </UButton>
                <UButton
                  size="sm"
                  :color="showKeypad ? 'primary' : 'neutral'"
                  :variant="showKeypad ? 'soft' : 'outline'"
                  icon="i-lucide-grid-3x3"
                  :disabled="!hydrated"
                  class="justify-center rounded-control"
                  data-testid="telephony-dtmf-toggle"
                  @click="toggleKeypadPanel"
                >
                  {{ labels.keypad }}
                </UButton>
              </div>

              <!-- Blind transfer inline form -->
              <div v-if="showTransfer" class="grid gap-1.5 rounded-inner border border-default p-2" data-testid="telephony-transfer-panel">
                <div class="flex items-center gap-1.5">
                  <UInput
                    v-model="transferTarget"
                    dir="ltr"
                    inputmode="tel"
                    size="sm"
                    :placeholder="labels.transferPlaceholder"
                    :disabled="!hydrated || state.transferring"
                    class="flex-1"
                    data-testid="telephony-transfer-input"
                    @keydown.enter.prevent="submitTransfer"
                  />
                  <UButton
                    size="sm"
                    icon="i-lucide-send"
                    :disabled="!hydrated || state.transferring || !transferTarget.trim()"
                    :loading="state.transferring"
                    class="rounded-control"
                    data-testid="telephony-transfer-submit"
                    @click="submitTransfer"
                  >
                    {{ state.transferring ? labels.transferring : labels.transferSend }}
                  </UButton>
                </div>
                <p v-if="activeTransferError" role="alert" class="text-xs text-error" data-testid="telephony-transfer-error">
                  {{ activeTransferError }}
                </p>
              </div>

              <!-- DTMF keypad -->
              <div v-if="showKeypad" class="grid gap-2 rounded-inner border border-default p-2" data-testid="telephony-dtmf-panel">
                <p v-if="dtmfTrail" class="truncate text-center text-xs font-medium tracking-widest text-muted tabular-nums" dir="ltr">
                  {{ dtmfTrail }}
                </p>
                <div class="grid grid-cols-3 gap-1.5" dir="ltr">
                  <UButton
                    v-for="digit in DIAL_KEYS"
                    :key="digit"
                    size="sm"
                    color="neutral"
                    variant="outline"
                    :disabled="!hydrated"
                    class="justify-center rounded-inner tabular-nums"
                    :data-testid="`telephony-dtmf-${digit}`"
                    @click="pressDtmf(digit)"
                  >
                    {{ digit }}
                  </UButton>
                </div>
              </div>
            </div>

            <!-- Primary call actions -->
            <div class="flex flex-wrap items-center gap-2 border-t border-default pt-3">
              <UButton
                v-if="phase === 'ringing'"
                size="sm"
                color="success"
                icon="i-lucide-phone-incoming"
                :disabled="!hydrated"
                class="flex-1 justify-center rounded-control"
                data-testid="telephony-popover-answer"
                @click="answer"
              >
                {{ labels.answer }}
              </UButton>
              <UButton
                v-if="phase === 'ringing'"
                size="sm"
                color="error"
                variant="outline"
                icon="i-lucide-phone-off"
                :disabled="!hydrated"
                class="flex-1 justify-center rounded-control"
                data-testid="telephony-popover-reject"
                @click="reject"
              >
                {{ labels.reject }}
              </UButton>
              <UButton
                v-if="phase === 'calling' || phase === 'in-call'"
                size="sm"
                color="error"
                icon="i-lucide-phone-off"
                :disabled="!hydrated"
                class="w-full justify-center rounded-control"
                data-testid="telephony-popover-hangup"
                @click="hangUp"
              >
                {{ labels.hangUp }}
              </UButton>
            </div>
          </template>

          <!-- Failed state -->
          <template v-else-if="phase === 'failed'">
            <div class="grid gap-2" data-testid="telephony-failed-panel">
              <p class="text-sm font-semibold text-error">{{ labels.failed }}</p>
              <p class="text-xs text-muted">{{ labels.failedHint }}</p>
              <p v-if="state.failure" class="text-xs text-muted">{{ state.failure }}</p>
              <UButton
                size="sm"
                color="primary"
                variant="soft"
                icon="i-lucide-refresh-cw"
                :disabled="!hydrated"
                class="w-fit rounded-control"
                data-testid="telephony-retry"
                @click="retry"
              >
                {{ labels.retry }}
              </UButton>
            </div>
          </template>

          <!-- Idle / registered without extension -->
          <template v-else-if="!state.hasExtension">
            <div class="flex items-start gap-2.5 text-sm text-muted" data-testid="telephony-no-extension">
              <UIcon name="i-lucide-phone-off" class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p>{{ labels.noExtension }}</p>
            </div>
          </template>

          <!-- Idle / registered with extension: E.164 dialpad -->
          <template v-else>
            <div class="grid gap-2.5" data-testid="telephony-dialpad">
              <div class="flex items-center justify-between gap-2">
                <p class="text-sm font-semibold text-highlighted">{{ labels.dialpadTitle }}</p>
                <bdi v-if="state.registeredAs" dir="ltr" class="text-xs text-muted tabular-nums">
                  {{ state.registeredAs }}
                </bdi>
              </div>

              <div class="flex items-center gap-1.5">
                <UInput
                  v-model="dialNumber"
                  dir="ltr"
                  inputmode="tel"
                  :placeholder="labels.dialPlaceholder"
                  :disabled="!hydrated"
                  class="flex-1"
                  data-testid="telephony-dial-input"
                  @keydown.enter.prevent="submitDial"
                />
                <UButton
                  size="sm"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-delete"
                  :aria-label="labels.backspace"
                  :disabled="!hydrated || !dialNumber"
                  class="rounded-control"
                  data-testid="telephony-dial-backspace"
                  @click="backspaceDial"
                />
              </div>

              <p v-if="dialError" role="alert" class="text-xs text-error" data-testid="telephony-dial-error">
                {{ dialError }}
              </p>

              <div class="grid grid-cols-3 gap-1.5" dir="ltr">
                <UButton
                  v-for="digit in DIAL_KEYS"
                  :key="digit"
                  size="sm"
                  color="neutral"
                  variant="outline"
                  :disabled="!hydrated"
                  class="justify-center rounded-inner tabular-nums"
                  :data-testid="`telephony-dial-key-${digit}`"
                  @click="appendDial(digit)"
                >
                  {{ digit }}
                </UButton>
              </div>

              <div class="flex items-center gap-1.5">
                <UButton
                  size="sm"
                  color="neutral"
                  variant="outline"
                  :disabled="!hydrated"
                  class="w-12 justify-center rounded-control"
                  data-testid="telephony-dial-key-+"
                  @click="appendDial('+')"
                >
                  +
                </UButton>
                <UButton
                  size="sm"
                  color="success"
                  icon="i-lucide-phone-outgoing"
                  :disabled="!hydrated || !dialNumber.trim()"
                  class="flex-1 justify-center rounded-control"
                  data-testid="telephony-dial-submit"
                  @click="submitDial"
                >
                  {{ labels.dialCall }}
                </UButton>
              </div>
            </div>
          </template>
        </div>
      </template>
    </UPopover>

    <!-- Direct action buttons on the chip itself -->
    <template v-if="phase === 'ringing'">
      <UButton
        size="xs"
        color="success"
        variant="solid"
        icon="i-lucide-phone"
        :disabled="!hydrated"
        :aria-label="labels.answer"
        class="rounded-inner"
        data-testid="telephony-chip-answer"
        @click.stop="answer"
      >
        {{ labels.answer }}
      </UButton>
      <UButton
        size="xs"
        color="error"
        variant="soft"
        icon="i-lucide-phone-off"
        :disabled="!hydrated"
        :aria-label="labels.reject"
        class="rounded-inner"
        data-testid="telephony-chip-reject"
        @click.stop="reject"
      >
        {{ labels.reject }}
      </UButton>
    </template>

    <UButton
      v-else-if="phase === 'calling' || phase === 'in-call'"
      size="xs"
      color="error"
      variant="solid"
      icon="i-lucide-phone-off"
      :disabled="!hydrated"
      :aria-label="labels.hangUp"
      class="rounded-inner"
      data-testid="telephony-chip-hangup"
      @click.stop="hangUp"
    >
      {{ labels.hangUp }}
    </UButton>
  </div>
</template>
