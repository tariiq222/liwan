import { ApiError } from '../../composables/useApi'

type Translate = (key: string, params?: Record<string, unknown>) => string

/**
 * The message to show for a failed finance call: the user's language for a code `keyOf` knows, else the server's
 * own text, and a generic line for a failure that is not an API answer. `params` fills the known message from the error.
 */
export function financeErrorMessage(
  cause: unknown,
  keyOf: (code: string) => string | null,
  t: Translate,
  params?: (error: ApiError) => Record<string, unknown> | undefined,
): string {
  if (!(cause instanceof ApiError)) return t('errors.generic')
  const key = keyOf(cause.code)
  return key ? t(key, params?.(cause)) : cause.message
}
