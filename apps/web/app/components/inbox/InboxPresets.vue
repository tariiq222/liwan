<script setup lang="ts">
import { InboxPresetKeySchema, type InboxPresetKey } from '@liwan/contracts'
import { useApplyInboxPreset } from '@/composables/inbox/useInboxSettings'

// A sector preset sets several options at once: its departments, tags, canned replies and visibility policy. Applying
// is idempotent (only what is missing is added), but it changes the policy, so it asks first, inline.
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const { mutate: apply, isPending } = useApplyInboxPreset()
const PRESETS = InboxPresetKeySchema.options
const asking = ref<InboxPresetKey | null>(null)
const ICONS: Record<InboxPresetKey, string> = { clinic: 'i-lucide-stethoscope', store: 'i-lucide-store', public_service: 'i-lucide-landmark' }

function applyAsked() {
  if (!asking.value) return
  apply(asking.value, {
    onSuccess: () => {
      toast.add({ title: t('inbox.settings.presets.applied', { name: t(`inbox.settings.presets.${asking.value}.name`) }), color: 'success' })
      asking.value = null
    },
    onError: e => toast.add({ title: e instanceof Error ? e.message : t('errors.generic'), color: 'error' }),
  })
}
</script>

<template>
  <SharedRecordSection id="presets" variant="panel" class="liwan-settings-anchor" :title="t('inbox.settings.presets.title')" :description="t('inbox.settings.presets.hint')">
    <ul class="grid gap-3 sm:grid-cols-3">
      <SharedSubCard v-for="key in PRESETS" :key="key" as="li" class="flex flex-col gap-2" :data-testid="`inbox-preset-${key}`">
        <span class="flex size-9 items-center justify-center rounded-full bg-primary/10 text-primary"><UIcon :name="ICONS[key]" class="size-5" aria-hidden="true" /></span>
        <h3 class="text-sm font-semibold text-highlighted">{{ t(`inbox.settings.presets.${key}.name`) }}</h3>
        <p class="flex-1 text-sm text-muted">{{ t(`inbox.settings.presets.${key}.description`) }}</p>
        <UButton type="button" color="neutral" variant="outline" class="self-start" :disabled="!hydrated || isPending" :label="t('inbox.settings.presets.apply')" @click="asking = key" />
      </SharedSubCard>
    </ul>
    <SharedInlineConfirm
      v-if="asking"
      class="mt-3"
      color="warning"
      :title="t('inbox.settings.presets.confirmTitle', { name: t(`inbox.settings.presets.${asking}.name`) })"
      :description="t('inbox.settings.presets.confirmDescription')"
      :confirm-label="t('inbox.settings.presets.apply')"
      :pending="isPending"
      @confirm="applyAsked"
      @cancel="asking = null"
    />
  </SharedRecordSection>
</template>
