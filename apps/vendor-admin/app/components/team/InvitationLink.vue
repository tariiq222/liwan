<script setup lang="ts">
import { formatDateTime } from '@liwan/ui/app/utils/formatDate'
import { useCopyLink } from '@/composables/useCopyLink'

const props = defineProps<{ name: string, link: string, expiresAt: string }>()
const emit = defineEmits<{ dismiss: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const copier = useCopyLink()
const outcome = computed(() => copier.outcomeFor(props.link))
</script>

<template>
  <section class="grid gap-3 rounded-lg border border-default bg-elevated/40 p-4" data-slot="invitation-link" :aria-label="t('team.link.title', { name: props.name })">
    <h2 class="text-base font-semibold text-highlighted">
      {{ t('team.link.title', { name: props.name }) }}
    </h2>
    <p class="text-sm text-muted">
      {{ t('team.link.hint') }}
    </p>
    <UFormField :label="t('team.link.label')">
      <UInput :model-value="props.link" readonly dir="ltr" class="w-full" data-testid="invitation-link-value" @focus="($event.target as HTMLInputElement).select()" />
    </UFormField>
    <p class="text-sm text-muted">
      {{ t('team.link.expires', { date: formatDateTime(props.expiresAt) }) }}
    </p>
    <div class="flex flex-wrap items-center gap-2">
      <UButton type="button" icon="i-lucide-copy" :disabled="!hydrated" :label="t('team.link.copy')" data-testid="invitation-link-copy" @click="copier.copy(props.link)" />
      <UButton type="button" color="neutral" variant="outline" :disabled="!hydrated" :label="t('team.link.dismiss')" data-testid="invitation-link-dismiss" @click="emit('dismiss')" />
      <p role="status" class="text-sm" :class="outcome === 'failed' ? 'text-error' : 'text-success'">
        <template v-if="outcome">{{ t(outcome === 'copied' ? 'team.link.copied' : 'team.link.copyFailed') }}</template>
      </p>
    </div>
  </section>
</template>
