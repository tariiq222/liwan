/**
 * The only file that loads `@sentry/node`. The Nitro plugin imports it dynamically and only when `NUXT_SENTRY_DSN` is set, so an
 * install without a DSN never loads the SDK. Errors only: no tracing, profiling, default integrations or client reports.
 */
import * as Sentry from '@sentry/node'
import { scrubEvent, SDK_DATA_COLLECTION } from '../../../shared/utils/errorReportScrub'
import type { ErrorReportingSettings } from './settings'

export type ServerReporter = {
  /** Reports one error; `request` is the route it happened on and `tenant` overrides the install's own tenant. */
  capture(error: unknown, request?: { method: string; path: string; userAgent?: string }, tenant?: string): void
  flush(): Promise<void>
}

export function startServerReporter(settings: ErrorReportingSettings, transport?: Sentry.NodeOptions['transport']): ServerReporter {
  const environment = settings.environment || undefined
  const release = settings.release || undefined
  Sentry.init({
    dsn: settings.dsn,
    environment,
    release,
    dataCollection: SDK_DATA_COLLECTION,
    defaultIntegrations: false,
    enableOpenTelemetrySetup: false,
    sendClientReports: false,
    transport,
    beforeSend: event => scrubEvent(event, {
      runtime: 'web-server',
      release,
      environment,
      tenant: typeof event.tags?.tenant === 'string' ? event.tags.tenant : undefined,
    }),
  })
  return {
    capture(error, request, tenant = settings.tenant) {
      Sentry.withScope((scope) => {
        if (tenant) scope.setTag('tenant', tenant)
        if (request) {
          scope.addEventProcessor(event => ({
            ...event,
            request: { method: request.method, url: request.path, headers: request.userAgent ? { 'user-agent': request.userAgent } : undefined },
          }))
        }
        Sentry.captureException(error)
      })
    },
    async flush() {
      await Sentry.flush(2000)
    },
  }
}
