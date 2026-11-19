<script setup lang="ts">
import { formatDateTime } from '@liwan/ui/app/utils/formatDate'
import { canReachPath } from '@/utils/accessPolicy'

definePageMeta({ layout: false, middleware: 'customer-commercial' })
const { t } = useI18n()
const api = useSubscriptionApi()
const router = useRouter()
const { me, refresh } = useMe()
const { can } = useCustomerCapabilities()
const checked = useState<number | null>('trial-activation-checked', () => null)
const POLL_LIMIT_MS = 5 * 60 * 1000
let deadline = 0
const busy = ref(false)
const failed = ref(false)
// The clock already started but the apps are not open yet: the server retries on its own, so the page keeps asking.
const delayedEnd = ref<string | null>(null)
let retryTimer: ReturnType<typeof setTimeout> | undefined
let disposed = false

async function openTrial(start: boolean) {
  if (busy.value || disposed) return
  if (!can('subscription.manage')) { await router.replace('/'); return }
  if (start && (!deadline || failed.value)) deadline = Date.now() + POLL_LIMIT_MS
  if (!delayedEnd.value && Date.now() >= deadline) { failed.value = true; return }
  busy.value = true
  failed.value = false
  try {
    const status = await (start ? api.activateTrial() : api.trialActivation())
    if (disposed) return
    if (status.state === 'failed') {
      delayedEnd.value = status.trial_ends_at ?? null
      retryTimer = setTimeout(() => { void openTrial(false) }, 3000)
    } else if (status.state === 'waiting' || status.state === 'applying') {
      retryTimer = setTimeout(() => { void openTrial(status.state === 'waiting') }, 3000)
    } else {
      delayedEnd.value = null
      await refresh()
      if (disposed) return
      const identity = me.value
      if (identity) checked.value = identity.id
      const target = status.state === 'ready' && identity
        ? ['/inbox', '/crm'].find(path => canReachPath(identity, path)) ?? '/'
        : '/'
      await router.replace(target)
    }
  } catch {
    if (disposed) return
    if (delayedEnd.value) retryTimer = setTimeout(() => { void openTrial(false) }, 3000)
    else failed.value = true
  } finally {
    busy.value = false
  }
}

async function continueWithoutTrial() {
  if (me.value) checked.value = me.value.id
  await router.replace('/')
}

onMounted(() => { void openTrial(true) })
onBeforeUnmount(() => { disposed = true; clearTimeout(retryTimer) })
</script>

<template>
  <SharedStandalonePage>
    <template #header>
      <SharedBrandWordmark size="md" />
      <h1 class="font-display text-lg font-semibold text-highlighted">{{ t('subscription.activation.title') }}</h1>
    </template>
    <div v-if="delayedEnd" class="grid gap-3">
      <UAlert role="status" color="warning" variant="subtle" :title="t('subscription.activation.delayed', { date: formatDateTime(delayedEnd, 'Asia/Riyadh') })" />
      <UButton type="button" variant="outline" color="neutral" :label="t('subscription.activation.continue')" @click="continueWithoutTrial" />
    </div>
    <p v-else-if="!failed" role="status" class="text-sm text-muted">{{ t('subscription.activation.wait') }}</p>
    <div v-else class="grid gap-3">
      <UAlert role="alert" color="error" variant="subtle" :title="t('subscription.activation.failed')" />
      <UButton type="button" :loading="busy" :label="t('subscription.activation.retry')" @click="openTrial(true)" />
      <UButton type="button" variant="outline" color="neutral" :label="t('subscription.activation.continue')" @click="continueWithoutTrial" />
    </div>
  </SharedStandalonePage>
</template>
