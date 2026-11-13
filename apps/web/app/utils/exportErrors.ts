import { ExportTooLargeDetailsSchema } from '@liwan/contracts'

/**
 * The text of a row export the server refused (422 `export_too_large`) because the filters keep more rows than one file
 * carries: it names the limit and asks to narrow the filters. Null for any other failure, which keeps its own text.
 */
export function exportTooLargeMessage(error: unknown, t: (key: string, params: { max: string }) => string, n: (value: number) => string): string | null {
  const failure = error as { status?: number; code?: string; details?: unknown } | null
  if (failure?.status !== 422 || failure.code !== 'export_too_large') return null
  const parsed = ExportTooLargeDetailsSchema.safeParse(failure.details)
  return parsed.success ? t('errors.exportTooLarge', { max: n(parsed.data.max_rows) }) : null
}
