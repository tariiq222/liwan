<script setup lang="ts">
import type { LocationDraft } from '@/composables/inbox/inboxLocation'
import { buildLocation, locationDraftFrom } from '@/composables/inbox/inboxLocation'

// The location an agent sends: coordinates typed in, or the browser's position when the agent asks for it (the click is
// the consent; the browser then asks its own permission). Name and address are optional.
const draft = defineModel<LocationDraft>({ required: true })
const { t } = useI18n()
const hydrated = useHydrated()
const locating = ref(false)
const problem = ref('')
const invalid = computed(() => !!(draft.value.latitude.trim() || draft.value.longitude.trim()) && !buildLocation(draft.value))

function useMyPosition() {
  problem.value = ''
  if (!navigator.geolocation) {
    problem.value = t('inbox.composer.location.unsupported')
    return
  }
  locating.value = true
  navigator.geolocation.getCurrentPosition(
    (position) => {
      locating.value = false
      draft.value = { ...locationDraftFrom(position.coords.latitude, position.coords.longitude), name: draft.value.name, address: draft.value.address }
    },
    () => {
      locating.value = false
      problem.value = t('inbox.composer.location.denied')
    },
    { timeout: 10_000 },
  )
}
</script>

<template>
  <SharedSubCard tone="tinted" class="flex flex-col gap-2" data-testid="inbox-location-form">
    <div class="grid grid-cols-2 gap-2">
      <UFormField :label="t('inbox.composer.location.latitude')" :error="invalid ? t('inbox.composer.location.invalid') : undefined">
        <UInput v-model="draft.latitude" class="w-full" inputmode="decimal" dir="ltr" placeholder="24.7136" maxlength="24" :disabled="!hydrated" />
      </UFormField>
      <UFormField :label="t('inbox.composer.location.longitude')">
        <UInput v-model="draft.longitude" class="w-full" inputmode="decimal" dir="ltr" placeholder="46.6753" maxlength="24" :disabled="!hydrated" />
      </UFormField>
    </div>
    <UFormField :label="t('inbox.composer.location.name')">
      <UInput v-model="draft.name" class="w-full" maxlength="1000" :disabled="!hydrated" />
    </UFormField>
    <UFormField :label="t('inbox.composer.location.address')">
      <UInput v-model="draft.address" class="w-full" maxlength="1000" :disabled="!hydrated" />
    </UFormField>
    <div class="flex flex-wrap items-center gap-2">
      <UButton type="button" color="neutral" variant="outline" icon="i-lucide-locate-fixed" :loading="locating" :disabled="!hydrated" :label="t('inbox.composer.location.useMine')" @click="useMyPosition" />
      <p class="text-xs text-muted">{{ t('inbox.composer.location.consent') }}</p>
    </div>
    <p v-if="problem" class="text-xs text-error" role="alert">{{ problem }}</p>
  </SharedSubCard>
</template>
