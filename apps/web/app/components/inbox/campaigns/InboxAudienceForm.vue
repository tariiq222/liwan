<script setup lang="ts">
import type { InboxAudience, InboxAudienceTagMatch } from '@liwan/contracts'
import { useInboxTags } from '@/composables/inbox/useInbox'
import { useSaveInboxAudience } from '@/composables/inbox/useInboxCampaigns'

// An audience is a saved, typed segment: contacts that carry some (or all) of the chosen tags, without the excluded tags,
// optionally only those who wrote in the last N days. It stores no members; the counts are taken live by the server and
// shown for a saved audience.
const props = defineProps<{ audience?: InboxAudience; backTo: string }>()
const emit = defineEmits<{ saved: [audience: InboxAudience] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const { mutateAsync: save, isPending } = useSaveInboxAudience()
const tags = useInboxTags()

const draft = reactive({
  name: props.audience?.name ?? '',
  tagIds: props.audience?.tags.map(tag => tag.id) ?? [] as number[],
  tagMatch: (props.audience?.tag_match ?? 'any') as InboxAudienceTagMatch,
  excludeTagIds: props.audience?.exclude_tags.map(tag => tag.id) ?? [] as number[],
  activeWithinDays: props.audience?.active_within_days ?? 0,
})
const write = () => ({
  name: draft.name.trim(), tag_ids: draft.tagIds, tag_match: draft.tagMatch, exclude_tag_ids: draft.excludeTagIds,
  active_within_days: Math.max(0, Math.round(draft.activeWithinDays || 0)),
})
const initial = JSON.stringify(write())
const saved = ref(false)
const dirty = computed(() => !saved.value && JSON.stringify(write()) !== initial)
const attempted = ref(false)
const serverError = ref<{ field?: string; message: string } | null>(null)
const off = computed(() => !hydrated.value || isPending.value)
const tagItems = computed(() => tags.data.value?.items ?? [])
const matchItems = computed(() => (['any', 'all'] as const).map(value => ({ value, label: t(`inbox.campaigns.audiences.match.${value}`) })))
const nameError = computed(() => attempted.value && !draft.name.trim() ? t('inbox.settings.requiredName') : undefined)
const fieldError = (field: string) => serverError.value?.field === field ? serverError.value.message : undefined

async function submit() {
  attempted.value = true
  serverError.value = null
  if (off.value || !draft.name.trim()) return
  try {
    const audience = await save({ id: props.audience?.id, body: write() })
    saved.value = true
    toast.add({ title: t('inbox.settings.saved'), color: 'success' })
    emit('saved', audience)
  } catch (e) {
    const field = (e as { field?: string }).field
    serverError.value = { field, message: e instanceof Error ? e.message : t('errors.generic') }
    toast.add({ title: serverError.value.message, color: 'error' })
  }
}
</script>

<template>
  <form class="flex flex-col gap-5" novalidate data-testid="inbox-audience-form" @submit.prevent="submit">
    <SharedUnsavedChanges :dirty="dirty" />
    <UFormField :label="t('inbox.settings.name')" required :error="nameError ?? fieldError('name')">
      <UInput v-model="draft.name" class="w-full" maxlength="128" :disabled="off" data-testid="inbox-audience-name" />
    </UFormField>
    <UFormField :label="t('inbox.campaigns.audiences.tags')" :description="t('inbox.campaigns.audiences.tagsHint')" :error="fieldError('tag_ids')">
      <USelectMenu v-model="draft.tagIds" multiple value-key="id" label-key="name" :items="tagItems" class="w-full" :disabled="off" :placeholder="t('inbox.campaigns.audiences.everyone')" :aria-label="t('inbox.campaigns.audiences.tags')" data-testid="inbox-audience-tags" />
    </UFormField>
    <UFormField v-if="draft.tagIds.length > 1" :label="t('inbox.campaigns.audiences.matchLabel')">
      <SharedSegmentedControl v-model="draft.tagMatch" :items="matchItems" :label="t('inbox.campaigns.audiences.matchLabel')" :disabled="off" />
    </UFormField>
    <UFormField :label="t('inbox.campaigns.audiences.exclude')" :description="t('inbox.campaigns.audiences.excludeHint')" :error="fieldError('exclude_tag_ids')">
      <USelectMenu v-model="draft.excludeTagIds" multiple value-key="id" label-key="name" :items="tagItems" class="w-full" :disabled="off" :placeholder="t('inbox.campaigns.audiences.noExclude')" :aria-label="t('inbox.campaigns.audiences.exclude')" />
    </UFormField>
    <UFormField :label="t('inbox.campaigns.audiences.activeWithin')" :description="t('inbox.campaigns.audiences.activeWithinHint')" :error="fieldError('active_within_days')">
      <UInputNumber v-model="draft.activeWithinDays" class="w-full sm:w-60" :min="0" :max="3650" :disabled="off" data-testid="inbox-audience-active" />
    </UFormField>
    <div v-if="props.audience" class="grid grid-cols-2 gap-(--liwan-gap-card)" data-testid="inbox-audience-counts">
      <SharedMetricTile density="compact" icon="i-lucide-users" :label="t('inbox.campaigns.audiences.contacts')" :value="props.audience.contact_count" />
      <SharedMetricTile density="compact" icon="i-lucide-send" :label="t('inbox.campaigns.audiences.reachable')" :value="props.audience.reachable_count" :hint="t('inbox.campaigns.audiences.reachableHint')" tone="success" />
    </div>
    <div class="flex justify-end gap-2">
      <UButton :to="props.backTo" color="neutral" variant="outline" :disabled="off" :label="t('app.cancel')" />
      <UButton type="submit" :disabled="off" :loading="isPending" :label="props.audience ? t('app.save') : t('inbox.campaigns.audiences.create')" data-testid="inbox-audience-submit" />
    </div>
  </form>
</template>
