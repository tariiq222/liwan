<script setup lang="ts">
import type { PageHeaderTag } from '@liwan/ui/app/utils/pageHeaderTag'
import type { RowAction } from '@liwan/ui/app/components/shared/data/RowActions.vue'
import { owningListBack, recordChildTo } from '@/utils/recordListOrigin'
import { normalizedPath } from '@/utils/routePath'
import { ApiError } from '@/composables/useApi'
import ProductDetails from '@/components/products/ProductDetails.vue'
import { productManagedReason } from '@/composables/products/productErrors'
import { useProductManagedElsewhere } from '@/composables/products/productManagement'
import { useArchiveProduct, useProduct, useRestoreProduct } from '@/composables/products/useProducts'

const route = useRoute()
const sourcePaths = useRecordListPaths(['/products'])
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const id = computed(() => Number(route.params.id))
const validId = computed(() => Number.isSafeInteger(id.value) && id.value > 0)
// A trailing slash still names the record, not a child page.
const isDetail = computed(() => normalizedPath(route.path) === `/products/${route.params.id}`)
const query = useProduct(computed(() => isDetail.value && validId.value ? id.value : null))
const product = computed(() => query.data.value)
// Invalid ids have no record to load and use the same not-found state as an unknown positive id.
const pageError = computed(() => query.error.value ?? (validId.value ? null : new ApiError(404, 'not_found', t('errors.generic'))))
const backTo = computed(() => owningListBack(route.query, sourcePaths.value, route.hash))
const canManage = computed(() => can('products.manage'))
const canEdit = computed(() => canManage.value || can('products.prices.manage'))
// A product another company manages shows no write action: the reason stands in their place.
const managedElsewhere = useProductManagedElsewhere(product)

const confirmArchive = ref(false)
const { mutateAsync: archive, isPending: archiving } = useArchiveProduct()
const { mutateAsync: restore, isPending: restoring } = useRestoreProduct()
const archivePending = computed(() => archiving.value || restoring.value)
const archiveError = ref<unknown>(null)
const archiveFailure = computed(() => {
  const reason = productManagedReason(archiveError.value)
  return reason ? t(`products.managed.${reason}`) : t('errors.generic')
})
async function toggleArchive() {
  if (!product.value || !hydrated.value || archivePending.value) return
  try {
    if (product.value.active) await archive(product.value.id)
    else await restore(product.value.id)
    confirmArchive.value = false
    archiveError.value = null
  } catch (failure) { archiveError.value = failure }
}

const headerTags = computed<PageHeaderTag[]>(() => product.value
  ? [
      { label: t(`products.type.${product.value.type}`), kind: 'category', icon: product.value.type === 'goods' ? 'i-lucide-package' : 'i-lucide-briefcase-business' },
      { label: t(product.value.active ? 'products.status.active' : 'products.status.archived'), tone: product.value.active ? 'success' : 'neutral' },
    ]
  : [])
const writable = computed(() => !!product.value && !managedElsewhere.value)
const menuActions = computed<RowAction[]>(() => {
  if (!product.value || !canManage.value) return []
  return [{
    label: product.value.active ? t('products.archive') : t('products.restore'),
    icon: product.value.active ? 'i-lucide-archive' : 'i-lucide-archive-restore',
    destructive: product.value.active,
    onSelect: () => { confirmArchive.value = !confirmArchive.value },
  }]
})
</script>

<template>
  <SharedRecordPage
    v-if="isDetail"
    :keep-content="!!product"
    :title="product?.name || t('products.recordTitle')"
    :tags="headerTags"
    :back-to="backTo"
    :loading="query.isLoading.value"
    :error="pageError"
    @retry="query.refetch"
  >
    <template v-if="product && writable && canEdit" #actions>
      <UButton color="primary" icon="i-lucide-pencil" :disabled="!hydrated" :to="recordChildTo(`/products/${id}/edit`, route.query, sourcePaths, route.hash)" :label="t('app.edit')" data-testid="product-edit" @click="!hydrated && $event.preventDefault()" />
      <SharedRowActions v-if="menuActions.length" :actions="menuActions" :label="t('products.rowActions', { name: product.name })" :disabled="archivePending" />
    </template>
    <UAlert v-if="managedElsewhere && canEdit" color="info" variant="subtle" icon="i-lucide-lock" :title="t('products.managed.title')" :description="t(`products.managed.${managedElsewhere}`)" data-testid="product-managed-elsewhere" />
    <SharedInlineConfirm
      v-if="product && confirmArchive"
      :color="product.active ? 'error' : 'primary'"
      :title="t(product.active ? 'products.archiveConfirm' : 'products.restoreConfirm', { name: product.name })"
      :description="archiveError ? archiveFailure : t(product.active ? 'products.archiveHint' : 'products.restoreHint')"
      :confirm-label="product.active ? t('products.archive') : t('products.restore')"
      :pending="archivePending"
      @confirm="toggleArchive"
      @cancel="confirmArchive = false; archiveError = null"
    />
    <SharedIdentityCard v-if="product" :id="product.id" :name="product.name" :subtitle="t(`products.type.${product.type}`)" />
    <template v-if="product" #aside>
      <ProductDetails :product="product" />
    </template>
  </SharedRecordPage>
  <NuxtPage v-else />
</template>
