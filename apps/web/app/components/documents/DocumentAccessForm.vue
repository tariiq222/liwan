<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import type { DocumentAccess, DocumentAccessUpdate } from '@liwan/contracts'
import { documentAccessPayload } from '@/lib/documentAccess'
const props = defineProps<{ access: DocumentAccess; pending?: boolean; error?: string; conflict?: boolean; backTo?: RouteLocationRaw }>()
const emit = defineEmits<{ save: [body: DocumentAccessUpdate]; reload: [] }>()
const { t } = useI18n(); const hydrated = useHydrated()
const visibility = ref(props.access.visibility); const grants = ref<DocumentAccess['grants']>(props.access.grants.map(grant => ({ user: { ...grant.user }, access: grant.access })))
const selected = ref<number | null>(null); const validation = ref(''); const revision = ref(props.access.revision)
const baseline = ref(JSON.stringify([visibility.value, grants.value]))
const dirty = computed(() => baseline.value !== JSON.stringify([visibility.value, grants.value]))
const editorCount = computed(() => grants.value.filter(grant => grant.access === 'editor').length)
function reload() {
  visibility.value = props.access.visibility; grants.value = props.access.grants.map(grant => ({ user: { ...grant.user }, access: grant.access })); revision.value = props.access.revision
  baseline.value = JSON.stringify([visibility.value, grants.value]); validation.value = ''
}
// Acknowledged save changes the baseline only when it matches this draft; refetch never discards edits.
watch(() => props.access, access => { if (!dirty.value || (access.visibility === visibility.value && JSON.stringify(access.grants) === JSON.stringify(grants.value))) reload() })
function resolvePeople(people: { id: number; name: string }[]) { for (const user of people) if (!grants.value.some(grant => grant.user.id === user.id)) grants.value.push({ user, access: 'reader' }); selected.value = null }
function submit() {
  if (!hydrated.value || props.pending || props.conflict) return
  try { emit('save', documentAccessPayload(revision.value, visibility.value, grants.value)); validation.value = '' }
  catch { validation.value = t('documents.editorRequired') }
}
</script>
<template>
  <SharedUnsavedChanges :dirty="dirty || !!pending" />
  <UForm :state="{ visibility, grants }" class="liwan-form" @submit="submit">
    <UAlert v-if="error || validation" color="error" :title="error || validation" />
    <UAlert v-if="conflict" color="warning" :title="t('documents.conflict')" :description="t('documents.conflictHelp')"><template #actions><UButton type="button" color="neutral" :label="t('documents.reload')" :disabled="pending" @click="emit('reload')" /></template></UAlert>
    <SharedFormSection panel :title="t('documents.access')">
      <div class="grid gap-(--liwan-gap-card)">
        <UFormField :label="t('documents.visibility')" name="document-visibility"><USelect id="document-visibility" v-model="visibility" :items="[{ value: 'restricted', label: t('documents.visibilityOptions.restricted') }, { value: 'company', label: t('documents.visibilityOptions.company') }]" class="w-full" :disabled="!hydrated || pending || conflict" /></UFormField>
        <p class="text-sm text-muted">{{ t(`documents.visibilityHelp.${visibility}`) }}</p>
        <UFormField :label="t('documents.addPerson')" name="document-grant-person"><SharedPersonPicker v-model="selected" value-key="user_id" :exclude="grants.map(grant => grant.user.id)" :disabled="!hydrated || pending || conflict" @resolve="resolvePeople" /></UFormField>
        <ul class="grid gap-(--liwan-gap-card)">
          <li v-for="grant in grants" :key="grant.user.id" class="flex flex-wrap items-center gap-2">
            <span class="min-w-0 flex-1 break-words">{{ grant.user.name }}</span>
            <USelect v-model="grant.access" :aria-label="t('documents.personAccess', { name: grant.user.name })" :items="[{ value: 'reader', label: t('documents.reader'), disabled: grant.access === 'editor' && editorCount === 1 }, { value: 'editor', label: t('documents.editor') }]" :disabled="!hydrated || pending || conflict" />
            <UButton type="button" color="error" variant="ghost" icon="i-lucide-x" :aria-label="t('documents.removePerson', { name: grant.user.name })" :disabled="!hydrated || pending || conflict || (grant.access === 'editor' && editorCount === 1)" @click="grants = grants.filter(item => item.user.id !== grant.user.id)" />
          </li>
        </ul>
        <p class="text-sm text-muted">{{ t('documents.editorRequired') }}</p>
      </div>
    </SharedFormSection>
    <SharedFormActions><div class="ms-auto flex gap-2"><UButton v-if="backTo" type="button" color="neutral" variant="outline" :to="backTo" :label="t('app.cancel')" :disabled="pending" /><UButton type="submit" :label="t('app.save')" :loading="pending" :disabled="!hydrated || conflict || !editorCount" /></div></SharedFormActions>
  </UForm>
</template>
