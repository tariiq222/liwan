<script setup lang="ts">
import { type CardFormSession, DEAD_INTENT_FAILURES, moyasarFormConfig, scopedFormCss, sessionMsLeft, STAND_IN_PUBLISHABLE_KEY } from '@/utils/cardPayment'
// Card details are typed into the provider's own form: this component never reads, sends, logs or stores a card field. It only
// mounts the form from the server's session and reports whether the session is still usable.
const props = defineProps<{ session: CardFormSession; saveCard: boolean }>()
const emit = defineEmits<{ expired: [] }>()
const { t, locale } = useI18n()
const host = ref<HTMLElement | null>(null)
const loadFailed = ref(false)
const standIn = computed(() => props.session.publishable_key === STAND_IN_PUBLISHABLE_KEY)
let style: HTMLStyleElement | null = null
let timer: ReturnType<typeof setTimeout> | undefined
// A timer longer than 2^31-1 ms fires at once, so a far-off end is watched in steps.
const MAX_TIMER_MS = 2 ** 31 - 1
function watchExpiry() {
  const left = sessionMsLeft(props.session)
  if (left <= 0) { emit('expired'); return }
  timer = setTimeout(watchExpiry, Math.min(left, MAX_TIMER_MS))
}
async function mountForm() {
  if (standIn.value || !host.value) return
  try {
    // Client only and only here: the package is never part of another page's code, and never runs during server rendering.
    const [{ default: Moyasar }, { default: css }] = await Promise.all([
      import('moyasar-payment-form'),
      import('moyasar-payment-form/dist/moyasar.css?raw'),
    ])
    if (!host.value) return
    style = document.createElement('style')
    style.textContent = scopedFormCss(css)
    document.head.append(style)
    Moyasar.init(moyasarFormConfig(props.session, {
      element: host.value, saveCard: props.saveCard, locale: locale.value, origin: window.location.origin,
      description: t('subscription.pay.formDescription'),
      onFailure: failure => { if (failure?.type && DEAD_INTENT_FAILURES.has(failure.type)) emit('expired') },
    }))
  } catch { loadFailed.value = true }
}
onMounted(() => { watchExpiry(); void mountForm() })
onBeforeUnmount(() => { clearTimeout(timer); style?.remove(); host.value?.replaceChildren() })
</script>
<template>
  <div class="space-y-3" data-slot="payment-form">
    <div v-if="standIn" class="space-y-2 rounded-control border border-dashed border-default p-4" data-testid="payment-form-stand-in">
      <p class="font-medium text-highlighted">{{ t('subscription.pay.standIn.title') }}</p>
      <p class="text-sm text-muted">{{ t('subscription.pay.standIn.description') }}</p>
      <p class="text-sm text-muted" dir="ltr"><bdi>{{ session.intent.id }}</bdi></p>
      <p class="text-sm text-muted">{{ t(saveCard ? 'subscription.pay.standIn.saving' : 'subscription.pay.standIn.notSaving') }}</p>
    </div>
    <UAlert v-else-if="loadFailed" color="error" variant="subtle" role="alert" data-testid="payment-form-load-failed" :title="t('subscription.pay.loadFailed')" />
    <!-- The provider's form is left to right inside right-to-left text: card digits never flip. -->
    <div v-show="!standIn && !loadFailed" ref="host" dir="ltr" data-testid="payment-form-host" />
  </div>
</template>
