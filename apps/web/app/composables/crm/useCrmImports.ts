import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/vue-query'
import {
  CrmImportBatchListSchema,
  CrmImportBatchSchema,
  CrmImportFileInfoSchema,
  CrmImportMappingListSchema,
  CrmImportMappingSchema,
  CrmImportPreviewSchema,
  type CrmImportFile,
  type CrmImportMappingCreate,
  type CrmImportRequest,
} from '@webvue/contracts'
import { crmKeys } from './crmKeys'

// The server caps a page at 200; a company has a handful of saved mappings.
const MAPPING_LIMIT = 200

export function useCrmImportBatches(params: MaybeRefOrGetter<{ limit: number; offset: number }>) {
  const { $api } = useApi()
  const { can } = useAccess()
  return useQuery({
    queryKey: computed(() => crmKeys.importBatches(toValue(params))),
    enabled: computed(() => can('crm.leads.import')),
    queryFn: () => $api('/api/v1/crm/imports', { query: toValue(params), schema: CrmImportBatchListSchema }),
    placeholderData: keepPreviousData,
  })
}

export function useCrmImportMappings() {
  const { $api } = useApi()
  const { can } = useAccess()
  return useQuery({
    queryKey: crmKeys.importMappings,
    enabled: computed(() => can('crm.leads.import')),
    queryFn: () => $api('/api/v1/crm/import-mappings', { query: { limit: MAPPING_LIMIT }, schema: CrmImportMappingListSchema }),
  })
}

/**
 * The calls of the import flow. Reading the columns, the preview and saving a profile change nothing in the lists;
 * the import itself creates opportunities and a batch, so their cached lists are refetched.
 */
export function useCrmImportActions() {
  const { $api } = useApi()
  const qc = useQueryClient()
  return {
    columns: useMutation({
      mutationFn: (file: CrmImportFile) => $api('/api/v1/crm/imports/columns', { method: 'POST', body: file, schema: CrmImportFileInfoSchema }),
    }),
    preview: useMutation({
      mutationFn: (body: CrmImportRequest) => $api('/api/v1/crm/imports/preview', { method: 'POST', body, schema: CrmImportPreviewSchema }),
    }),
    commit: useMutation({
      mutationFn: (body: CrmImportRequest) => $api('/api/v1/crm/imports', { method: 'POST', body, schema: CrmImportBatchSchema }),
      onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: crmKeys.importBatchesAll }), qc.invalidateQueries({ queryKey: [...crmKeys.opportunities, 'list'] }), qc.invalidateQueries({ queryKey: crmKeys.dashboardAll })]),
    }),
    saveMapping: useMutation({
      mutationFn: (body: CrmImportMappingCreate) => $api('/api/v1/crm/import-mappings', { method: 'POST', body, schema: CrmImportMappingSchema }),
      onSuccess: () => qc.invalidateQueries({ queryKey: crmKeys.importMappings }),
    }),
    deleteMapping: useMutation({
      mutationFn: (id: number) => $api(`/api/v1/crm/import-mappings/${id}`, { method: 'DELETE', schema: CrmImportMappingSchema }),
      onSuccess: () => qc.invalidateQueries({ queryKey: crmKeys.importMappings }),
    }),
  }
}
