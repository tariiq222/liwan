// Optional error reporting to a self-hosted Sentry (owner decision 2026-11-18). `NUXT_SENTRY_DSN` is read at runtime only; with it
// unset nothing here loads the SDK, opens a connection or exposes the browser tunnel. `public.errorReporting` follows the runtime
// config the way `public.aiEnabled` does (see ai-enabled.ts): the browser learns at runtime whether to report, never from the build.
import { getHeader, type H3Event } from 'h3'
import { parseDsn } from '../utils/errorReporting/dsn'
import { errorReportingSettings, isUnexpectedError, type NitroError } from '../utils/errorReporting/settings'

export default defineNitroPlugin((nitroApp) => {
  const config = useRuntimeConfig()
  const settings = errorReportingSettings(config)
  if (!settings.dsn) return

  // An unusable DSN throws here and a missing SDK exits below: either way the server stops at start, because a report channel
  // that silently never works is worse than none.
  const { publicKey, projectId } = parseDsn(settings.dsn)
  const reporter = import('../utils/errorReporting/serverSdk').then(({ startServerReporter }) => startServerReporter(settings))
  reporter.catch((error) => {
    console.error('[liwan-errors] NUXT_SENTRY_DSN is set but the error reporter cannot start:', error)
    process.exit(1)
  })

  // The browser gets a placeholder host with the real key pair; its envelopes go to the same-origin tunnel, which checks the pair.
  nitroApp.hooks.hook('request', (event) => {
    useRuntimeConfig(event).public.errorReporting = {
      enabled: true,
      dsn: `https://${publicKey}@errors.invalid/${projectId}`,
      release: settings.release,
      environment: settings.environment,
    }
  })

  nitroApp.hooks.hook('error', async (error: NitroError, { event }: { event?: H3Event }) => {
    if (!isUnexpectedError(error)) return
    const tenant = (event?.context.tenant as { tenantId?: string } | null | undefined)?.tenantId
    const request = event && { method: event.method, path: event.path, userAgent: getHeader(event, 'user-agent') }
    // Nitro wraps an unhandled throw in a 500; the original error carries the useful stack.
    ;(await reporter).capture(error.cause instanceof Error ? error.cause : error, request, tenant)
  })
  nitroApp.hooks.hook('close', async () => { await (await reporter).flush() })
})
