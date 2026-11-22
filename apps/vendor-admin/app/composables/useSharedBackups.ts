import type { MaybeRefOrGetter } from 'vue'
import type { SharedBackupList } from '@liwan/commercial-contracts'

/** The backups of one shared workspace. Calls with the same id share the data, so the panel and its actions read and refresh one copy. */
export function useSharedBackups(id: MaybeRefOrGetter<string>) {
  const { request } = useVendorApi()
  return useAsyncData(
    () => `vendor:tenant-backups:${toValue(id)}`,
    () => request<SharedBackupList>(`shared/tenants/${encodeURIComponent(toValue(id))}/backups`),
  )
}
