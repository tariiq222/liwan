export type SharedTenantInput = {
  name: string
  catalog_version?: string
  catalog_tier?: string
  package_revision_id?: string
  admin_name: string
  admin_login: string
  reason: string
}
export type SharedTenantCreated = { tenant_id: string; job_id: string | null; status: string; host: string; replay: boolean }
export type SharedTenantProgress = { tenant_id: string; job_id: string | null; status: string; host: string | null; admin_login: string | null; stage: string | null; error_code: string | null }

// One request identity survives transport failures and navigation cancellation.
export function createSharedTenantRequest(randomUUID: () => string = () => crypto.randomUUID()) {
  let requestId: string | null = null
  return {
    body(input: SharedTenantInput) {
      requestId ??= randomUUID()
      const selection = input.package_revision_id ? { package_revision_id: input.package_revision_id } : { catalog_version: input.catalog_version, catalog_tier: input.catalog_tier }
      return { request_id: requestId, name: input.name, ...selection, admin_name: input.admin_name, admin_login: input.admin_login, reason: input.reason }
    },
    acceptedNavigation() { requestId = null },
  }
}

export function sharedTenantLoginUrl(progress: SharedTenantProgress | null | undefined): string | null {
  if (progress?.status !== 'active' || progress.stage !== 'active' || progress.error_code || !progress.host) return null
  // The API supplies a hostname, never a URL or an operator path.
  if (!/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(progress.host) || progress.host.includes('..')) return null
  return `https://${progress.host}/login`
}
