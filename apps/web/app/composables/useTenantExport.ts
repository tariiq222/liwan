import { type MaybeRefOrGetter } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { saveBlob } from '../utils/saveBlob'
import { TenantExportListSchema, TenantExportSchema, type TenantExportList } from '@liwan/contracts'
import { exportRefreshDelay, TENANT_EXPORT_PATH } from '../utils/tenantExport'

/**
 * The tenant data export: the recent jobs (re-read calmly while one is queued or running), the request that starts
 * a new one, and the download of a finished archive. The server enforces the capability, the root company and the
 * session coverage; `enabled` only keeps a user who cannot use the page from sending a request at all.
 */
export function useTenantExport(enabled: MaybeRefOrGetter<boolean>) {
  const { $api, $download } = useApi()
  const { me } = useMe()
  const client = useQueryClient()
  const key = computed(() => ['tenant-export', me.value?.id, me.value?.company.id])
  const list = useQuery<TenantExportList>({
    queryKey: key,
    enabled,
    retry: false,
    refetchIntervalInBackground: false,
    refetchInterval: query => exportRefreshDelay(query.state.data?.items),
    queryFn: ({ signal }) => $api(TENANT_EXPORT_PATH, { schema: TenantExportListSchema, signal }),
  })
  const refresh = () => client.invalidateQueries({ queryKey: key.value })
  // A refused request (409: a job is already running) also means the list on screen is stale.
  const request = useMutation({
    mutationFn: () => $api(TENANT_EXPORT_PATH, { method: 'POST', body: {}, schema: TenantExportSchema }),
    onSettled: refresh,
  })
  const download = useMutation({
    mutationFn: async (id: number) => {
      const { blob, filename } = await $download(`${TENANT_EXPORT_PATH}/${id}/download`)
      saveBlob(blob, filename ?? `liwan-export-${id}.zip`)
    },
  })
  return { list, request, download }
}
