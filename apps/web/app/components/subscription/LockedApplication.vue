<script setup lang="ts">
import type { LockedAudience, LockedCause } from '@/utils/lockedApplication'

// The page a closed application shows in place of its content. It states the cause as far as the data tells, gives a
// subscription manager one way forward, and keeps the user's existing data reachable while the application is readable.
// A member and a `non_saas` company never see a plan or payment link.
const props = withDefaults(defineProps<{
  /** The application's localized name, or null when the path belongs to no application. */
  application: string | null
  cause: LockedCause
  audience: LockedAudience
  /** A page of the application the user can still read; null when the application is not readable. */
  dataPath: string | null
  /** The shell shows the heading; the standalone card already carries the title. */
  heading?: boolean
}>(), { heading: true })
const { t } = useI18n()
const app = computed(() => props.application ?? t('subscription.locked.thisApplication'))
const titleKey = computed(() => props.cause === 'not_in_plan' ? 'notInPlan' : props.cause === 'not_enabled' ? 'notEnabled' : 'readOnly')
const causeKey = computed(() => ({ not_in_plan: 'notInPlan', payment_suspended: 'paymentSuspended', read_only: 'readOnly', not_enabled: 'notEnabled' })[props.cause])
const pays = computed(() => props.cause === 'payment_suspended')
const headingEl = useTemplateRef<HTMLElement>('headingEl')
onMounted(() => headingEl.value?.focus())
</script>

<template>
  <section class="mx-auto grid max-w-md justify-items-center gap-3 py-12 text-center" data-testid="locked-application" :aria-labelledby="heading ? 'locked-application-title' : undefined">
    <UIcon name="i-lucide-lock" class="size-8 text-muted" aria-hidden="true" />
    <h1 v-if="heading" id="locked-application-title" ref="headingEl" tabindex="-1" class="text-xl font-semibold text-highlighted outline-none">{{ t(`subscription.locked.title.${titleKey}`, { app }) }}</h1>
    <p class="text-sm text-default" data-testid="locked-cause">{{ t(`subscription.locked.cause.${causeKey}`, { app }) }}</p>
    <p v-if="dataPath" class="text-sm text-muted" data-testid="locked-readable">{{ t('subscription.locked.readable') }}</p>
    <p v-if="audience === 'member'" class="text-sm text-muted" data-testid="locked-ask-admin">{{ t(pays ? 'subscription.locked.askSubscriptionManager' : 'subscription.locked.askAdmin') }}</p>
    <p v-else-if="audience === 'non_saas'" class="text-sm text-muted" data-testid="locked-ask-admin">{{ t('subscription.locked.askAdmin') }}</p>
    <div v-if="audience === 'manager' || dataPath" class="mt-2 flex flex-wrap justify-center gap-2">
      <UButton
        v-if="audience === 'manager'"
        :to="pays ? '/subscription' : '/subscription/change'"
        :icon="pays ? 'i-lucide-credit-card' : 'i-lucide-repeat'"
        :label="t(pays ? 'subscription.locked.actions.pay' : 'subscription.locked.actions.seePlans')"
        :aria-label="t(pays ? 'subscription.locked.actions.payLabel' : 'subscription.locked.actions.seePlansLabel', { app })"
      />
      <UButton
        v-if="dataPath"
        :to="dataPath"
        icon="i-lucide-eye"
        color="neutral"
        :variant="audience === 'manager' ? 'outline' : 'solid'"
        :label="t('subscription.locked.actions.openData')"
        :aria-label="t('subscription.locked.actions.openDataLabel', { app })"
      />
    </div>
  </section>
</template>
