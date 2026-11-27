<script setup lang="ts">
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  TelephonyExtensionListSchema,
  TelephonyExtensionSchema,
  type TelephonyExtension,
  type TelephonyExtensionList,
} from '@liwan/contracts'
import { ApiError } from '@/composables/useApi'
import { useSettingsForm } from '@/composables/settings/useSettingsForm'

/*
 * The extensions card of the telephony settings (DESIGN.md §6): the row that adds an extension, then the company's
 * extensions with the user each belongs to and an active/inactive toggle. The card's draft is the new extension:
 * saving posts it, adds the server's answer to the list and clears the row. A refusal that names one of the two fields
 * is shown under that field as well as in the card, so nothing the server says is lost.
 */
const EXTENSIONS = ['telephony', 'extensions'] as const
const NO_LIST: TelephonyExtensionList = { items: [], total: 0 }

interface ExtensionDraft { number: string; userId: number | null }

const props = defineProps<{ id: string; canEdit: boolean }>()
const { t } = useI18n()
const { $api } = useApi()
const hydrated = useHydrated()
const queryClient = useQueryClient()

const extensions = useQuery({
  queryKey: EXTENSIONS,
  queryFn: ({ signal }) => $api('/api/v1/telephony/extensions', { schema: TelephonyExtensionListSchema, signal }),
})
const rows = computed(() => extensions.data.value?.items ?? [])

const isField = (field: string | undefined): field is keyof ExtensionDraft => field === 'number' || field === 'userId'
/** The refusal of the last save, under each field the server named. */
const fieldErrors = ref<Partial<Record<keyof ExtensionDraft, string>>>({})
const togglingId = ref<number | null>(null)
const toggleError = ref<string | null>(null)

const { draft, state, save, revert, reload } = useSettingsForm<TelephonyExtensionList, ExtensionDraft>({
  // Until the list arrives the baseline is empty; the row is drawn only once the list is here.
  source: () => extensions.data.value ?? NO_LIST,
  // Every draft is a new extension: nothing of the saved list is copied into it.
  read: () => ({ number: '', userId: null }),
  // Spaces around the number are neither an edit nor part of what is sent.
  compare: ({ number, userId }) => ({ number: number.trim(), userId }),
  save: async (values, latest) => {
    fieldErrors.value = {}
    try {
      const created = await $api('/api/v1/telephony/extensions', {
        method: 'POST',
        body: { number: values.number.trim(), userId: values.userId },
        schema: TelephonyExtensionSchema,
      })
      const next = { items: [...latest.items, created], total: latest.total + 1 }
      queryClient.setQueryData(EXTENSIONS, next)
      return next
    } catch (error) {
      if (error instanceof ApiError && isField(error.field)) fieldErrors.value = { ...fieldErrors.value, [error.field]: error.message }
      throw error
    }
  },
  reload: async () => {
    const result = await extensions.refetch()
    if (result.isError) throw result.error
    return result.data ?? NO_LIST
  },
})

// A field whose value changed is no longer the one the refusal was about.
watch(draft, () => { fieldErrors.value = {} }, { deep: true })

async function toggleActive(extension: TelephonyExtension) {
  if (!hydrated.value || !props.canEdit || togglingId.value !== null) return
  togglingId.value = extension.id
  toggleError.value = null
  try {
    const updated = await $api(`/api/v1/telephony/extensions/${extension.id}`, {
      method: 'PATCH',
      body: { active: !extension.active },
      schema: TelephonyExtensionSchema,
    })
    const current = extensions.data.value ?? NO_LIST
    queryClient.setQueryData(EXTENSIONS, {
      items: current.items.map(item => (item.id === updated.id ? updated : item)),
      total: current.total,
    })
  } catch (error) {
    toggleError.value = error instanceof ApiError ? error.message : t('errors.generic')
  } finally {
    togglingId.value = null
  }
}

const locked = computed(() => !hydrated.value || !props.canEdit || state.value.saving || state.value.reloading)
</script>

<template>
  <SharedSettingsCard
    :id="id"
    v-bind="state"
    :title="t('telephony.settings.extensions')"
    :description="t('telephony.settings.extensionsHint')"
    :can-edit="canEdit"
    data-testid="telephony-extensions-card"
    @save="save"
    @revert="revert"
    @reload="reload"
  >
    <SharedPageState :loading="extensions.isLoading.value" :error="extensions.data.value ? null : extensions.error.value" @retry="extensions.refetch">
      <div class="liwan-auto-grid liwan-field-grid liwan-setting-fields">
        <UFormField :label="t('telephony.settings.extensionNumber')" :help="t('telephony.settings.extensionNumberHint')" :error="fieldErrors.number" name="extension-number">
          <UInput
            v-model="draft.number"
            class="w-full"
            inputmode="numeric"
            maxlength="10"
            dir="ltr"
            :placeholder="t('telephony.settings.extensionNumberPlaceholder')"
            :disabled="locked"
            data-testid="telephony-extension-number"
          />
        </UFormField>
        <UFormField :label="t('telephony.settings.extensionUser')" :help="t('telephony.settings.extensionUserHint')" :error="fieldErrors.userId" name="extension-user">
          <SharedPersonPicker v-model="draft.userId" value-key="user_id" :aria-label="t('telephony.settings.extensionUser')" :disabled="locked" data-testid="telephony-extension-user" />
        </UFormField>
      </div>
      <div class="border-t border-default pt-(--liwan-gap-card)">
        <UAlert v-if="toggleError" role="alert" color="error" variant="subtle" :description="toggleError" class="mb-3" data-testid="telephony-extension-toggle-error" />
        <ul v-if="rows.length" class="divide-y divide-default" data-testid="telephony-extensions">
          <li
            v-for="extension in rows"
            :key="extension.id"
            class="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm"
            :data-number="extension.number"
            :data-active="extension.active ? 'true' : 'false'"
          >
            <div class="flex items-center gap-2">
              <bdi dir="ltr" class="font-medium tabular-nums">{{ extension.number }}</bdi>
              <span class="text-xs" :class="extension.active ? 'text-success' : 'text-muted'">
                {{ t(extension.active ? 'telephony.settings.extensionActive' : 'telephony.settings.extensionInactive') }}
              </span>
            </div>
            <div class="flex items-center gap-3">
              <span v-if="extension.user">{{ extension.user.name }}</span>
              <span v-else class="text-muted">{{ t('telephony.settings.extensionNoUser') }}</span>
              <UButton
                v-if="canEdit"
                type="button"
                size="xs"
                color="neutral"
                variant="outline"
                :disabled="!hydrated || togglingId !== null"
                :loading="togglingId === extension.id"
                class="rounded-control"
                :data-testid="`telephony-extension-toggle-${extension.id}`"
                @click="toggleActive(extension)"
              >
                {{ t(extension.active ? 'telephony.settings.extensionDisable' : 'telephony.settings.extensionEnable') }}
              </UButton>
            </div>
          </li>
        </ul>
        <p v-else class="text-sm text-muted">{{ t('telephony.settings.extensionsEmpty') }}</p>
      </div>
    </SharedPageState>
  </SharedSettingsCard>
</template>
