<script setup lang="ts">
import type { AiCompanyNote } from '@liwan/contracts'
import { ApiError } from '@/composables/useApi'
import { useAiCompanyMemory, useDecideAiCompanyNote } from '@/composables/ai/useAiSettings'

// The company's identity and tone as the assistant learns them (spec 2026-11-04 §6.4): agents propose short notes, and
// a note reaches the assistant only after a settings manager of this company approves it. Approved notes can be removed.
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const notes = useAiCompanyMemory()
const { mutateAsync: decide, isPending } = useDecideAiCompanyNote()
const removing = ref<number | null>(null)

const proposed = computed(() => (notes.data.value?.items ?? []).filter(note => note.status === 'proposed'))
const approved = computed(() => (notes.data.value?.items ?? []).filter(note => note.status === 'approved'))

async function act(note: AiCompanyNote, approve: boolean) {
  try {
    await decide({ id: note.id, approve })
    removing.value = null
    toast.add({ title: t(approve ? 'ai.settings.companyMemory.approved' : 'ai.settings.companyMemory.removed'), color: 'success' })
  } catch (error) {
    const full = error instanceof ApiError && error.code === 'company_memory_full'
    toast.add({ title: t(full ? 'ai.settings.companyMemory.full' : 'errors.generic'), color: 'error' })
  }
}
</script>

<template>
  <SharedRecordSection id="company-memory" variant="panel" class="liwan-settings-anchor" :title="t('ai.settings.companyMemory.title')" :description="t('ai.settings.companyMemory.hint')" data-testid="ai-settings-company-memory">
    <SharedPageState v-if="!notes.data.value" :loading="notes.isLoading.value" :error="notes.error.value" :empty="true" @retry="notes.refetch()" />
    <div v-else class="grid gap-(--liwan-gap-card)">
      <div class="grid gap-2" data-testid="ai-company-proposed">
        <h3 class="text-sm font-medium">{{ t('ai.settings.companyMemory.proposed') }}</h3>
        <p v-if="!proposed.length" class="text-sm text-muted">{{ t('ai.settings.companyMemory.noProposals') }}</p>
        <SharedSubCard v-for="note in proposed" :key="note.id">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <p class="min-w-0 break-words text-sm">{{ note.content }}</p>
            <div class="flex gap-2">
              <UButton type="button" color="neutral" variant="outline" size="sm" :label="t('ai.settings.companyMemory.reject')" :disabled="!hydrated || isPending" @click="act(note, false)" />
              <UButton type="button" size="sm" :label="t('ai.settings.companyMemory.approve')" :disabled="!hydrated || isPending" @click="act(note, true)" />
            </div>
          </div>
        </SharedSubCard>
      </div>
      <div class="grid gap-2" data-testid="ai-company-approved">
        <h3 class="text-sm font-medium">{{ t('ai.settings.companyMemory.inUse') }}</h3>
        <p v-if="!approved.length" class="text-sm text-muted">{{ t('ai.settings.companyMemory.empty') }}</p>
        <template v-for="note in approved" :key="note.id">
          <SharedInlineConfirm
            v-if="removing === note.id" :title="t('ai.settings.companyMemory.removeTitle')" :description="note.content"
            :confirm-label="t('ai.settings.companyMemory.remove')" :pending="isPending" @cancel="removing = null" @confirm="act(note, false)"
          />
          <SharedSubCard v-else>
            <div class="flex flex-wrap items-center justify-between gap-3">
              <p class="min-w-0 break-words text-sm">{{ note.content }}</p>
              <UButton type="button" color="error" variant="ghost" size="sm" icon="i-lucide-trash-2" :aria-label="t('ai.settings.companyMemory.remove')" :disabled="!hydrated || isPending" @click="removing = note.id" />
            </div>
          </SharedSubCard>
        </template>
      </div>
    </div>
  </SharedRecordSection>
</template>
