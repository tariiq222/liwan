/**
 * The only file that loads `@sentry/browser`. The plugin imports it dynamically and only when the server says reporting is on,
 * so a page without a DSN never downloads the SDK. Errors only: no tracing, replay, default integrations or client reports.
 */
import * as Sentry from '@sentry/browser'
import { ERROR_REPORT_PATH, scrubEvent, SDK_DATA_COLLECTION } from '../../shared/utils/errorReportScrub'

export type BrowserReportingSettings = { dsn: string; release: string; environment: string }

export type BrowserReporter = { capture(error: unknown): void }

export function startBrowserReporting(settings: BrowserReportingSettings, userId: () => number | undefined, transport?: Sentry.BrowserOptions['transport']): BrowserReporter {
  const release = settings.release || undefined
  const environment = settings.environment || undefined
  Sentry.init({
    dsn: settings.dsn,
    // Same origin: the server checks and scrubs the report and passes it on, so the page never talks to Sentry.
    tunnel: ERROR_REPORT_PATH,
    release,
    environment,
    dataCollection: SDK_DATA_COLLECTION,
    defaultIntegrations: false,
    sendClientReports: false,
    transport,
    beforeSend: event => scrubEvent(event, { runtime: 'web-browser', release, environment, userId: userId() }),
  })
  return { capture: error => Sentry.captureException(error) }
}
