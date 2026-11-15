<script setup lang="ts">
import { recordParentTo } from '@/utils/recordListOrigin'
import ProductForm from '@/components/products/ProductForm.vue'
import { useProduct } from '@/composables/products/useProducts'

const route = useRoute()
const sourcePaths = useRecordListPaths(['/products'])
const { t } = useI18n()
const { can } = useAccess()
const id = computed(() => Number(route.params.id))
const query = useProduct(id)
const product = computed(() => query.data.value)
// The price right alone opens the form too: it then changes the price and nothing else.
const canEdit = computed(() => can('products.manage') || can('products.prices.manage'))
// Child pages always return to their current record; the list's referrer is carried as listOrigin.
const backTo = computed(() => recordParentTo(`/products/${id.value}`, {
  ...route.query, listOrigin: route.query.listOrigin ?? route.query.returnTo ?? null,
}, sourcePaths.value, route.hash))
// DESIGN.md section 5: a saved form is not sent again through Back, so the record replaces the editor in the history.
function saved() { void navigateTo(backTo.value, { replace: true }) }
</script>

<template>
  <SharedPageContainer>
    <SharedPageHeader :title="t('products.edit')" :back-to="backTo" />
    <SharedPageState empty-icon="i-lucide-lock" v-if="!canEdit" :empty="true" :empty-text="t('errors.forbidden')" />
    <SharedPageState empty-icon="i-lucide-package" v-else :loading="query.isLoading.value" :error="query.error.value" :empty="!product" @retry="query.refetch()">
      <ProductForm v-if="product" :product="product" :back-to="backTo" @saved="saved" />
    </SharedPageState>
  </SharedPageContainer>
</template>
