<script setup lang="ts">
import { useAiMemory, useForgetAiNotes } from '@/composables/ai/useAiMemory'

// What the assistant remembers about how this employee likes to work. Only they see these notes and can delete them;
// the assistant saves a note when it learns a lasting preference, never a copy of a record.
const { t, d } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const notes = useAiMemory()
const { mutateAsync: forget, isPending } = useForgetAiNotes()
const confirming = ref<number | 'all' | null>(null)

async function remove(target: number | 'all') {
  try {
    await forget(target === 'all' ? null : target)
    confirming.value = null
    toast.add({ title: t('ai.memory.deleted'), color: 'success' })
  } catch {
    toast.add({ title: t('errors.generic'), color: 'error' })
  }
}
</script>

<template>
  <SharedPageContainer>
    <SharedPageHeader :title="t('ai.memory.title')" back-to="/ai" :back-label="t('ai.title')" />
    <SharedPageState v-if="!notes.data.value" :loading="notes.isLoading.value" :error="notes.error.value" :empty="true" @retry="notes.refetch()" />
    <SharedRecordSection v-else variant="panel" :title="t('ai.memory.notes', { count: notes.data.value.total })" :description="t('ai.memory.description')" data-testid="ai-memory">
      <template v-if="notes.data.value.items.length" #actions>
        <UButton v-if="confirming !== 'all'" type="button" color="error" variant="outline" size="sm" :label="t('ai.memory.deleteAll')" :disabled="!hydrated || isPending" @click="confirming = 'all'" />
      </template>
      <div class="grid gap-2">
        <SharedInlineConfirm v-if="confirming === 'all'" :title="t('ai.memory.deleteAllTitle')" :confirm-label="t('ai.memory.deleteAll')" :pending="isPending" @cancel="confirming = null" @confirm="remove('all')" />
        <SharedEmptyState v-if="!notes.data.value.items.length" :title="t('ai.memory.empty')" />
        <template v-for="note in notes.data.value.items" :key="note.id">
          <SharedInlineConfirm v-if="confirming === note.id" :title="t('ai.memory.deleteTitle')" :description="note.content" :confirm-label="t('ai.memory.delete')" :pending="isPending" @cancel="confirming = null" @confirm="remove(note.id)" />
          <SharedSubCard v-else>
            <div class="flex items-start justify-between gap-3">
              <div class="grid min-w-0 gap-1">
                <p class="break-words text-sm">{{ note.content }}</p>
                <p class="text-xs text-muted">{{ d(new Date(note.created_at), 'short') }}</p>
              </div>
              <UButton type="button" color="error" variant="ghost" size="sm" icon="i-lucide-trash-2" :aria-label="t('ai.memory.delete')" :disabled="!hydrated || isPending" @click="confirming = note.id" />
            </div>
          </SharedSubCard>
        </template>
      </div>
    </SharedRecordSection>
  </SharedPageContainer>
</template>
