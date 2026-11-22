/** Storage amounts are stored in megabytes of 1024 KB; a gigabyte is 1024 MB. The console shows MB and GB only, always with the unit. */
export const MB_PER_GB = 1024
export const BYTES_PER_MB = 1024 * 1024
/** The limit key whose value is an amount of storage in MB. */
export const STORAGE_LIMIT_KEY = 'storage.limit_mb'

/** At most one decimal; a whole number prints without one. */
const trimmed = (value: number): string => String(Number(value.toFixed(1)))

/** MB below 1024 MB, GB from there. */
export function formatStorageMb(mb: number): string {
  return mb < MB_PER_GB ? `${trimmed(mb)} MB` : `${trimmed(mb / MB_PER_GB)} GB`
}
export const formatStorageBytes = (bytes: number): string => formatStorageMb(bytes / BYTES_PER_MB)
