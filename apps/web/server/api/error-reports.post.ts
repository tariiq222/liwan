import { errorReportingSettings } from '../utils/errorReporting/settings'
import { MAX_ENVELOPE_BYTES, relayBrowserReport } from '../utils/errorReporting/tunnel'

// The same-origin tunnel of the browser's error reports (ERROR_REPORT_PATH). Answers 404 until `NUXT_SENTRY_DSN` is set.
export default defineEventHandler(async (event) => {
  const settings = errorReportingSettings(useRuntimeConfig(event))
  const tenant = (event.context.tenant as { tenantId?: string } | null | undefined)?.tenantId
  const contentLength = Number(getHeader(event, 'content-length') ?? 0)
  const { status } = relayBrowserReport({
    settings: tenant ? { ...settings, tenant } : settings,
    secFetchSite: getHeader(event, 'sec-fetch-site'),
    contentLength,
    // A body that declares no length, or one over the limit, is refused without being read.
    body: contentLength > 0 && contentLength <= MAX_ENVELOPE_BYTES ? await readRawBody(event, false) : undefined,
  })
  if (status !== 204) throw createError({ statusCode: status })
  setResponseStatus(event, 204)
  return null
})
