import { ApiError } from '../composables/useApi'

type Translate = (key: string, params?: Record<string, unknown>) => string

/** The text of an access refusal: its translated `access.errors.<code>`, else a 409 as a conflict, else the server message. */
export function accessErrorMessage(error: unknown, t: Translate): string {
  if (!(error instanceof ApiError)) return t('errors.generic')
  if (error.code === 'weak_password') return t('access.errors.weakPassword')
  // A missing dependency names both permissions, in the language the request carried.
  const { permission_name: permission, missing_name: missing } = error.details ?? {}
  if (error.code === 'missing_dependency' && typeof permission === 'string' && typeof missing === 'string') return t('access.errors.missingDependencyNamed', { permission, missing })
  const key = `access.errors.${error.code}`
  if (error.code && t(key) !== key) return t(key)
  if (error.status === 409) return t('access.errors.conflict')
  return error.message || t('errors.generic')
}

/** The error a settings card rethrows from its save: the same status, code and field, with the translated message. */
export function accessSaveError(error: unknown, t: Translate): unknown {
  return error instanceof ApiError && error.status !== 0 ? new ApiError(error.status, error.code, accessErrorMessage(error, t), error.field, error.details) : error
}
