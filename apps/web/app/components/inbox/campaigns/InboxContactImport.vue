<script setup lang="ts">
import { InboxContactImportSchema, type InboxContactImportResult } from '@webvue/contracts'
import { fileToBase64 } from '@/utils/attachmentFile'
import { useInboxTags } from '@/composables/inbox/useInbox'
import { useImportInboxContacts } from '@/composables/inbox/useInboxCampaigns'

// Brings customers in from a CSV (UTF-8, a `phone` column, optional `name` and `tags` separated by `;`). Every row can also
// receive tags chosen here, and the whole import is recorded either as unknown consent or as opted in with its proof.
// An import never overrides an opt-out the customer made.
const MAX_BYTES = 2 * 1024 * 1024
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const { mutate: run, isPending } = useImportInboxContacts()
const tags = useInboxTags()
const file = ref<File | null>(null)
const tagIds = ref<number[]>([])
const consent = ref<'unknown' | 'opted_in'>('unknown')
const note = ref('')
const error = ref('')
const result = ref<InboxContactImportResult | null>(null)
const attempted = ref(false)
const tagItems = computed(() => tags.data.value?.items ?? [])
const consentItems = computed(() => (['unknown', 'opted_in'] as const).map(value => ({ value, label: t(`inbox.campaigns.import.consent.${value}`), description: t(`inbox.campaigns.import.consentHint.${value}`) })))
const noteError = computed(() => attempted.value && consent.value === 'opted_in' && !note.value.trim() ? t('inbox.campaigns.import.noteRequired') : undefined)

function pick(event: Event) {
  const input = event.target as HTMLInputElement
  const picked = input.files?.[0] ?? null
  input.value = ''
  error.value = ''
  result.value = null
  if (picked && picked.size > MAX_BYTES) {
    error.value = t('inbox.campaigns.import.tooLarge')
    file.value = null
    return
  }
  file.value = picked
}

async function submit() {
  attempted.value = true
  error.value = ''
  if (!hydrated.value || isPending.value || !file.value) return
  const body = { name: file.value.name, data: await fileToBase64(file.value), tag_ids: tagIds.value, consent: consent.value, ...(consent.value === 'opted_in' ? { consent_note: note.value.trim() } : {}) }
  if (!InboxContactImportSchema.safeParse(body).success) return
  run(body, {
    onSuccess: (done) => {
      result.value = done
      file.value = null
      toast.add({ title: t('inbox.campaigns.import.done', { created: done.created, updated: done.updated }), color: 'success' })
    },
    onError: e => { error.value = e instanceof Error ? e.message : t('errors.generic') },
  })
}
</script>

<template>
  <SharedRecordSection variant="panel" :title="t('inbox.campaigns.import.title')" :description="t('inbox.campaigns.import.description')" data-testid="inbox-contact-import">
    <form class="flex flex-col gap-4" novalidate @submit.prevent="submit">
      <UFormField :label="t('inbox.campaigns.import.file')" :description="t('inbox.campaigns.import.fileHint')" required>
        <div class="flex flex-wrap items-center gap-2">
          <SharedFileField accept=".csv,text/csv" :label="t('inbox.campaigns.import.choose')" :show-file-name="false" :disabled="!hydrated || isPending" data-testid="inbox-import-file" @change="pick" />
          <span v-if="file" class="inline-flex min-w-0 items-center gap-1.5 text-sm" data-testid="inbox-import-name"><UIcon name="i-lucide-file-spreadsheet" class="size-4 shrink-0 text-muted" aria-hidden="true" /><bdi class="truncate">{{ file.name }}</bdi></span>
        </div>
      </UFormField>
      <UFormField :label="t('inbox.campaigns.import.tags')" :description="t('inbox.campaigns.import.tagsHint')">
        <USelectMenu v-model="tagIds" multiple value-key="id" label-key="name" :items="tagItems" class="w-full" :disabled="!hydrated || isPending" :placeholder="t('inbox.campaigns.import.noTags')" :aria-label="t('inbox.campaigns.import.tags')" />
      </UFormField>
      <UFormField :label="t('inbox.campaigns.import.consentLabel')">
        <URadioGroup v-model="consent" :items="consentItems" :disabled="!hydrated || isPending" data-testid="inbox-import-consent" />
      </UFormField>
      <UFormField v-if="consent === 'opted_in'" :label="t('inbox.campaigns.import.note')" :description="t('inbox.campaigns.import.noteHint')" required :error="noteError">
        <UInput v-model="note" class="w-full" maxlength="256" :disabled="!hydrated || isPending" data-testid="inbox-import-note" />
      </UFormField>
      <p v-if="error" class="text-sm text-error" role="alert" data-testid="inbox-import-error">{{ error }}</p>
      <div class="flex justify-end">
        <UButton type="submit" icon="i-lucide-upload" :disabled="!hydrated || !file" :loading="isPending" :label="t('inbox.campaigns.import.submit')" data-testid="inbox-import-submit" />
      </div>
    </form>
    <div v-if="result" class="mt-4 flex flex-col gap-3" role="status" data-testid="inbox-import-result">
      <div class="grid grid-cols-3 gap-(--webvue-gap-card)">
        <SharedMetricTile density="compact" :label="t('inbox.campaigns.import.created')" :value="result.created" tone="success" />
        <SharedMetricTile density="compact" :label="t('inbox.campaigns.import.updated')" :value="result.updated" />
        <SharedMetricTile density="compact" :label="t('inbox.campaigns.import.skipped')" :value="result.skipped" :tone="result.skipped ? 'warning' : 'neutral'" />
      </div>
      <div v-if="result.errors.length">
        <h3 class="text-sm font-semibold text-highlighted">{{ t('inbox.campaigns.import.errors') }}</h3>
        <ul class="mt-1 flex flex-col gap-1 text-sm" data-testid="inbox-import-errors">
          <li v-for="item in result.errors" :key="item.line" class="flex gap-2"><span class="shrink-0 text-muted">{{ t('inbox.campaigns.import.line', { line: item.line }) }}</span><span>{{ item.message }}</span></li>
        </ul>
      </div>
    </div>
  </SharedRecordSection>
</template>
