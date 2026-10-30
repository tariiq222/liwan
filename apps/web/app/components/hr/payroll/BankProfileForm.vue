<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import {
  HR_BANK_COLUMN_SOURCES,
  HR_BANK_PROFILE_DELIMITERS,
  HR_BANK_PROFILE_ENCODINGS,
  HR_BANK_PROFILE_FOOTERS,
  HR_BANK_PROFILE_KINDS,
  HrBankProfilePatchSchema,
  HrBankProfileWriteSchema,
  type HrBankProfile,
  type HrBankProfileColumn,
} from '@liwan/contracts'
import { saveErrorMessage } from '@/utils/formFeedback'
import { payrollErrorMessage } from '@/utils/payrollErrors'

// The bank and WPS file layouts of the company: a name, the file's delimiter, encoding, header and footer, and the
// ordered columns, each taken from a payslip figure, the employee or a constant. A shared profile (the platform's
// seed) is read-only; a company profile is edited in a form that opens above the table and deleted after an inline
// confirmation. The component owns its writes and shows the server's refusal above the form. An edit or a delete sends
// the revision of the profile it opened; a 409 keeps the draft until the user reloads the latest profile.
const props = defineProps<{
  profiles: HrBankProfile[]
  canEdit: boolean
  reloadProfiles: () => Promise<HrBankProfile[]>
}>()

const { t } = useI18n()
const hydrated = useHydrated()
const { mutateAsync: save, isPending: saving } = useSaveHrBankProfile()
const { mutateAsync: remove, isPending: removing } = useDeleteHrBankProfile()

// The delimiter and encoding values are not locale-key safe; their keys are named here.
const DELIMITER_KEYS = { ',': 'comma', ';': 'semicolon', '\t': 'tab', '|': 'pipe' } as const
const ENCODING_KEYS = { 'utf-8': 'utf8', 'utf-8-sig': 'utf8Bom' } as const

const editing = ref<'new' | HrBankProfile | null>(null)
const deleting = ref<HrBankProfile | null>(null)
const name = ref('')
const kind = ref<HrBankProfile['kind']>(HR_BANK_PROFILE_KINDS[0])
const delimiter = ref<HrBankProfile['delimiter']>(HR_BANK_PROFILE_DELIMITERS[0])
const encoding = ref<HrBankProfile['encoding']>(HR_BANK_PROFILE_ENCODINGS[0])
const footer = ref<HrBankProfile['footer']>(HR_BANK_PROFILE_FOOTERS[0])
const includeHeader = ref(true)
const columns = ref<HrBankProfileColumn[]>([])
const attempted = ref(false)
// After a reload the profile that changed becomes the baseline again (or the form closes when it was deleted).
const { failure, conflict, reloading, reloadFailure, reload } = usePayrollConflict(() => props.reloadProfiles(), (profiles) => {
  const fresh = (profile: HrBankProfile) => profiles.find(row => row.id === profile.id) ?? null
  if (deleting.value) deleting.value = fresh(deleting.value)
  const target = editing.value
  if (target && target !== 'new') {
    const row = fresh(target)
    if (row) open(row)
    else close()
  }
})

const kindOptions = computed(() => HR_BANK_PROFILE_KINDS.map(value => ({ value, label: t(`hrPayroll.bankProfiles.kind.${value}`) })))
const delimiterOptions = computed(() => HR_BANK_PROFILE_DELIMITERS.map(value => ({ value, label: t(`hrPayroll.bankProfiles.delimiter.${DELIMITER_KEYS[value]}`) })))
const encodingOptions = computed(() => HR_BANK_PROFILE_ENCODINGS.map(value => ({ value, label: t(`hrPayroll.bankProfiles.encoding.${ENCODING_KEYS[value]}`) })))
const footerOptions = computed(() => HR_BANK_PROFILE_FOOTERS.map(value => ({ value, label: t(`hrPayroll.bankProfiles.footer.${value}`) })))
const sourceOptions = computed(() => HR_BANK_COLUMN_SOURCES.map(value => ({ value, label: t(`hrPayroll.bankProfiles.source.${value}`) })))

const blankColumn = (): HrBankProfileColumn => ({ source: HR_BANK_COLUMN_SOURCES[0], label: '', constant_value: '' })

function open(target: 'new' | HrBankProfile) {
  editing.value = target
  deleting.value = null
  attempted.value = false
  failure.value = null
  const profile = target === 'new' ? null : target
  name.value = profile?.name ?? ''
  kind.value = profile?.kind ?? HR_BANK_PROFILE_KINDS[0]
  delimiter.value = profile?.delimiter ?? HR_BANK_PROFILE_DELIMITERS[0]
  encoding.value = profile?.encoding ?? HR_BANK_PROFILE_ENCODINGS[0]
  footer.value = profile?.footer ?? HR_BANK_PROFILE_FOOTERS[0]
  includeHeader.value = profile?.include_header ?? true
  columns.value = profile ? profile.columns.map(column => ({ ...column })) : [blankColumn()]
}
function close() {
  editing.value = null
  failure.value = null
}
function askDelete(profile: HrBankProfile | null) {
  deleting.value = profile
  editing.value = null
  failure.value = null
}

function setSource(column: HrBankProfileColumn, source: HrBankProfileColumn['source']) {
  column.source = source
  if (source !== 'constant') column.constant_value = ''
}
const addColumn = () => { columns.value.push(blankColumn()) }
const removeColumn = (index: number) => { columns.value.splice(index, 1) }

const body = computed(() => ({
  name: name.value,
  kind: kind.value,
  delimiter: delimiter.value,
  encoding: encoding.value,
  include_header: includeHeader.value,
  footer: footer.value,
  columns: columns.value,
}))
const parsed = computed(() => HrBankProfileWriteSchema.safeParse(body.value))
const invalid = computed(() => attempted.value && !parsed.value.success)
const nameInvalid = computed(() => invalid.value && name.value.trim() === '')
const formAlert = computed(() => {
  if (conflict.value) return t('hrPayroll.revision.conflict')
  return failure.value ? saveErrorMessage(failure.value, t('errors.generic'), t('errors.saveUncertain')) : undefined
})
// A refused delete answers with a payroll refusal code (a profile a kept salary file names, 409); a refused save
// keeps the server's own text. The two never show together: opening a delete closes the form and the reverse.
const deleteAlert = computed(() => {
  if (conflict.value) return t('hrPayroll.revision.conflict')
  return failure.value ? payrollErrorMessage(failure.value, t, new Map()) : undefined
})
const locked = computed(() => !hydrated.value || saving.value || reloading.value)

async function submit() {
  if (locked.value || conflict.value || !editing.value) return
  attempted.value = true
  failure.value = null
  if (!parsed.value.success) return
  const target = editing.value
  try {
    await save(target === 'new'
      ? { body: parsed.value.data }
      : { id: target.id, body: HrBankProfilePatchSchema.parse({ ...parsed.value.data, revision: target.revision }) })
    close()
  } catch (error) { failure.value = error }
}

async function confirmDelete() {
  if (!hydrated.value || removing.value || reloading.value || conflict.value || !deleting.value) return
  failure.value = null
  try {
    await remove({ id: deleting.value.id, revision: deleting.value.revision })
    deleting.value = null
  } catch (error) { failure.value = error }
}

const tableColumns = computed<TableColumn<HrBankProfile>[]>(() => [
  { id: 'name', header: t('hrPayroll.bankProfiles.columns.name') },
  { id: 'kind', header: t('hrPayroll.bankProfiles.columns.kind') },
  { id: 'columns', header: t('hrPayroll.bankProfiles.columns.columns') },
  { id: 'actions', header: t('app.actions'), meta: { class: { th: 'w-[110px]', td: 'w-[110px]' } } },
])
const rowActions = (profile: HrBankProfile) => [
  { label: t('app.edit'), icon: 'i-lucide-pencil' as const, onSelect: () => open(profile) },
  { label: t('hrPayroll.bankProfiles.delete'), icon: 'i-lucide-trash-2' as const, destructive: true, onSelect: () => askDelete(profile) },
]
</script>

<template>
  <SharedRecordSection variant="panel" :title="t('hrPayroll.bankProfiles.title')" :description="t('hrPayroll.bankProfiles.hint')">
    <template v-if="props.canEdit" #actions>
      <UButton color="neutral" variant="outline" size="sm" icon="i-lucide-plus" :disabled="!hydrated" :label="t('hrPayroll.bankProfiles.add')" data-testid="hr-bank-profile-add" @click="open('new')" />
    </template>

    <UAlert v-if="deleting && deleteAlert" role="alert" color="error" variant="subtle" :title="deleteAlert" />
    <UButton v-if="conflict" color="neutral" variant="outline" :label="t('hrPayroll.revision.reload')" :loading="reloading" :disabled="!hydrated || reloading" data-testid="hr-bank-profile-reload" @click="reload" />
    <UAlert v-if="reloadFailure" role="alert" color="error" variant="subtle" :title="t('hrPayroll.revision.reloadError')" />
    <SharedInlineConfirm
      v-if="deleting"
      :title="t('hrPayroll.bankProfiles.deleteTitle', { name: deleting.name })"
      :description="t('hrPayroll.bankProfiles.deleteHint')"
      :confirm-label="t('hrPayroll.bankProfiles.delete')"
      :pending="removing"
      :disabled="removing || reloading || conflict"
      @confirm="confirmDelete"
      @cancel="askDelete(null)"
    />

    <UForm v-if="editing" novalidate :state="body" class="liwan-form" method="post" data-testid="hr-bank-profile-form" @submit="submit">
      <UAlert v-if="formAlert" role="alert" color="error" variant="subtle" :title="t('hrPayroll.bankProfiles.saveError')" :description="formAlert" />
      <SharedFormSection :title="editing === 'new' ? t('hrPayroll.bankProfiles.new') : t('hrPayroll.bankProfiles.edit')">
        <div class="liwan-form-grid">
          <UFormField :label="t('hrPayroll.bankProfiles.columns.name')" name="hr-bank-profile-name" required :error="nameInvalid ? t('hrPayroll.bankProfiles.fieldInvalid') : undefined">
            <UInput id="hr-bank-profile-name" v-model="name" class="w-full" :disabled="locked" data-testid="hr-bank-profile-name" />
          </UFormField>
          <UFormField :label="t('hrPayroll.bankProfiles.columns.kind')" name="hr-bank-profile-kind">
            <USelect id="hr-bank-profile-kind" v-model="kind" class="w-full" :items="kindOptions" :disabled="locked" data-testid="hr-bank-profile-kind" />
          </UFormField>
          <UFormField :label="t('hrPayroll.bankProfiles.delimiterLabel')" name="hr-bank-profile-delimiter">
            <USelect id="hr-bank-profile-delimiter" v-model="delimiter" class="w-full" :items="delimiterOptions" :disabled="locked" data-testid="hr-bank-profile-delimiter" />
          </UFormField>
          <UFormField :label="t('hrPayroll.bankProfiles.encodingLabel')" name="hr-bank-profile-encoding">
            <USelect id="hr-bank-profile-encoding" v-model="encoding" class="w-full" :items="encodingOptions" :disabled="locked" data-testid="hr-bank-profile-encoding" />
          </UFormField>
          <UFormField :label="t('hrPayroll.bankProfiles.footerLabel')" name="hr-bank-profile-footer">
            <USelect id="hr-bank-profile-footer" v-model="footer" class="w-full" :items="footerOptions" :disabled="locked" data-testid="hr-bank-profile-footer" />
          </UFormField>
          <UFormField name="hr-bank-profile-header">
            <UCheckbox id="hr-bank-profile-header" v-model="includeHeader" :label="t('hrPayroll.bankProfiles.includeHeader')" :disabled="locked" data-testid="hr-bank-profile-header" />
          </UFormField>
        </div>
      </SharedFormSection>
      <SharedFormSection :title="t('hrPayroll.bankProfiles.columns.columns')" :description="t('hrPayroll.bankProfiles.columnsHint')">
        <UAlert v-if="invalid && columns.length === 0" role="alert" color="error" variant="subtle" :title="t('hrPayroll.bankProfiles.columnsRequired')" />
        <ol class="grid gap-3" data-testid="hr-bank-profile-columns">
          <li v-for="(column, index) in columns" :key="index" class="liwan-form-grid items-end">
            <UFormField :label="t('hrPayroll.bankProfiles.source.label')" :name="`hr-bank-profile-source-${index}`">
              <USelect :id="`hr-bank-profile-source-${index}`" :model-value="column.source" class="w-full" :items="sourceOptions" :disabled="locked" :data-testid="`hr-bank-profile-source-${index}`" @update:model-value="setSource(column, $event)" />
            </UFormField>
            <UFormField :label="t('hrPayroll.bankProfiles.columnLabel')" :name="`hr-bank-profile-label-${index}`" required :error="invalid && column.label.trim() === '' ? t('hrPayroll.bankProfiles.fieldInvalid') : undefined">
              <UInput :id="`hr-bank-profile-label-${index}`" v-model="column.label" class="w-full" :disabled="locked" :data-testid="`hr-bank-profile-label-${index}`" />
            </UFormField>
            <UFormField v-if="column.source === 'constant'" :label="t('hrPayroll.bankProfiles.constantValue')" :name="`hr-bank-profile-constant-${index}`" required :error="invalid && column.constant_value.trim() === '' ? t('hrPayroll.bankProfiles.fieldInvalid') : undefined">
              <UInput :id="`hr-bank-profile-constant-${index}`" v-model="column.constant_value" class="w-full" :disabled="locked" :data-testid="`hr-bank-profile-constant-${index}`" />
            </UFormField>
            <UButton type="button" color="neutral" variant="ghost" icon="i-lucide-x" :disabled="locked" :aria-label="t('hrPayroll.bankProfiles.removeColumn')" :data-testid="`hr-bank-profile-remove-${index}`" @click="removeColumn(index)" />
          </li>
        </ol>
        <UButton type="button" color="neutral" variant="outline" size="sm" icon="i-lucide-plus" :disabled="locked" :label="t('hrPayroll.bankProfiles.addColumn')" data-testid="hr-bank-profile-add-column" @click="addColumn" />
      </SharedFormSection>
      <SharedFormActions>
        <UButton type="button" color="neutral" variant="outline" :disabled="saving" :label="t('app.cancel')" @click="close" />
        <UButton type="submit" color="primary" :disabled="locked || conflict" :loading="saving" :label="t('app.saveChanges')" data-testid="hr-bank-profile-submit" />
      </SharedFormActions>
    </UForm>

    <SharedEmptyState v-if="props.profiles.length === 0" compact :title="t('hrPayroll.bankProfiles.empty')" :description="t('hrPayroll.bankProfiles.emptyHint')" />
    <SharedDataTable v-else bare :rows="props.profiles" :columns="tableColumns" row-key="id" :caption="t('hrPayroll.bankProfiles.title')">
      <template #name-cell="{ row }"><span class="font-semibold text-highlighted">{{ row.original.name }}</span></template>
      <template #kind-cell="{ row }">{{ t(`hrPayroll.bankProfiles.kind.${row.original.kind}`) }}</template>
      <template #columns-cell="{ row }"><span class="tabular-nums">{{ row.original.columns.length }}</span></template>
      <template #actions-cell="{ row }">
        <SharedStatusBadge v-if="row.original.shared" size="sm" tone="neutral" :label="t('hrPayroll.bankProfiles.shared')" />
        <SharedRowActions v-else-if="props.canEdit" :actions="rowActions(row.original)" :label="row.original.name" />
      </template>
    </SharedDataTable>
  </SharedRecordSection>
</template>
