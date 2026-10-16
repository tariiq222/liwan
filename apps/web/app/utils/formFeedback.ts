/** A disconnected write has an unknown outcome; a confirmed rejection can explain its cause. */
export function saveErrorMessage(error: unknown, fallback: string, uncertain: string): string {
  if (!error || typeof error !== 'object' || !('status' in error) || typeof error.status !== 'number') return fallback
  return error.status === 0 ? uncertain : 'message' in error && typeof error.message === 'string' && error.message || fallback
}
