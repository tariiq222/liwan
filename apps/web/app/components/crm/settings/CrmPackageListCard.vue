<script setup lang="ts">
import { CrmPackageSchema, type CrmPackage } from '@liwan/contracts'
import { useCrmListEditor, useCrmPackages } from '@/composables/crm/useCrmLists'
import { useCrmTerms } from '@/composables/crm/useCrmTerms'

// The packages a sale can pick: products of the products service the company chose to offer. A package is added by
// picking an existing product and removed from the list only (the product itself is edited in the products list); the
// opportunity's value comes from the chosen package.
const props = defineProps<{ canEdit: boolean }>()
const { t, n } = useI18n()
const hydrated = useHydrated()
const { termFor } = useCrmTerms()
const query = useCrmPackages()
const editor = useCrmListEditor<CrmPackage, { product_id: number }>('packages', CrmPackageSchema)
const rows = computed(() => query.data.value?.items ?? [])
const productId = ref<number | null>(null)
const locked = computed(() => !hydrated.value || !props.canEdit)
async function add() {
  if (productId.value !== null && await editor.add({ product_id: productId.value })) productId.value = null
}
</script>

<template>
  <SharedSettingsList
    id="packages"
    :title="t('crm.settings.packages.title')"
    :description="t('crm.settings.packages.hint')"
    :can-edit="canEdit"
    :message="editor.message.value"
    :loading="query.isLoading.value"
    :error="query.data.value ? null : query.error.value"
    :empty="!rows.length"
    :adding="editor.busy.value.includes(0)"
    :add-disabled="productId === null"
    @retry="query.refetch"
    @add="add"
  >
    <template #before>
      <p class="text-sm text-muted">{{ t('crm.settings.packages.count', { count: rows.length, term: termFor('package', rows.length) }) }}</p>
    </template>
    <li v-for="row in rows" :key="row.id" class="flex flex-wrap items-center gap-2" data-slot="settings-list-row">
      <span class="min-w-40 flex-1 truncate text-sm font-medium text-highlighted">{{ row.name }}</span>
      <span class="min-w-48 flex-[2] truncate text-sm text-muted">{{ row.description }}</span>
      <span class="w-36 text-sm"><span class="sr-only">{{ t('crm.settings.packages.price') }}: </span><bdi dir="ltr">{{ n(row.price) }}</bdi></span>
      <UBadge v-if="!row.active" color="neutral" variant="outline" :label="t('crm.settings.packages.archived')" />
      <UButton
        v-if="canEdit"
        type="button"
        color="neutral"
        variant="outline"
        size="sm"
        :label="t('crm.settings.packages.remove')"
        :aria-label="t('crm.settings.packages.removeNamed', { name: row.name })"
        :disabled="locked || editor.busy.value.includes(row.id)"
        :data-testid="`crm-package-remove-${row.id}`"
        @click="editor.remove(row.id)"
      />
    </li>
    <template v-if="canEdit" #add>
      <div class="w-full">
        <SharedProductPicker v-model="productId" :exclude="rows.map(row => row.id)" :disabled="locked" :aria-label="t('crm.settings.packages.pick')" />
      </div>
    </template>
  </SharedSettingsList>
</template>
