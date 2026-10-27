import type { TenantIdentity } from '../modules/registry'

const FILE_FEATURES = ['hr.enabled', 'hr.payroll']

/**
 * The salary files are server-side writes, so only the authoritative writable policy opens them: both the HR
 * feature and its payroll sub-feature must be listed in `platform.writable_features`. A /me without that policy
 * never falls back to ordinary entitlements; it stays closed.
 */
export function payrollFilesWritable(identity: TenantIdentity): boolean {
  const writable = identity?.platform?.writable_features
  return !!writable && FILE_FEATURES.every(key => writable.includes(key))
}
