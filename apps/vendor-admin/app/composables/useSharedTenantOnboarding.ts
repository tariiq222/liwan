export type SharedTenantProgress = { tenant_id: string; job_id: string | null; status: string; host: string | null; admin_login: string | null; stage: string | null; error_code: string | null }

export function sharedTenantLoginUrl(progress: SharedTenantProgress | null | undefined): string | null {
  if (progress?.status !== 'active' || progress.stage !== 'active' || progress.error_code || !progress.host) return null
  // The API supplies a hostname, never a URL or an operator path.
  if (!/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(progress.host) || progress.host.includes('..')) return null
  return `https://${progress.host}/login`
}
