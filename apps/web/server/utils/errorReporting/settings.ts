/** What the server reports with, from the runtime configuration; the tenant is the Odoo database of a dedicated install. */
export type ErrorReportingSettings = { dsn: string; environment: string; release: string; tenant: string }

type ReportingConfig = { sentryDsn: string; sentryEnvironment: string; odooDb: string }

export function errorReportingSettings(config: ReportingConfig): ErrorReportingSettings {
  return {
    dsn: config.sentryDsn,
    environment: config.sentryEnvironment,
    // The release the deployment already stamps on the image (see `releaseReadiness.ts`).
    release: process.env.LIWAN_RELEASE_ID ?? '',
    tenant: config.odooDb,
  }
}

export type NitroError = Error & { statusCode?: number; cause?: unknown }

/** Unexpected failures only: a handled `createError` below 500 (a 404, a refusal, a validation error) is a normal answer. */
export const isUnexpectedError = (error: NitroError) => (error.statusCode ?? 500) >= 500
