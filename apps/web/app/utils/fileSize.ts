type Translate = (key: string, params?: Record<string, unknown>) => string

const KIB = 1024
const MIB = 1024 * 1024

/**
 * A file size as the interface shows it: «12 كيلوبايت», «3.4 ميجابايت», «980 بايت».
 *
 * Two defects this replaces: the unit was a hardcoded English `MB`/`KB` inside an Arabic screen, and rounding every
 * size to one decimal megabyte printed «0.0 MB» for anything under 50 KB, so a real attachment looked empty. Sizes
 * below a megabyte are shown in kilobytes (or bytes when even that would round to zero), and the number and the unit
 * come from the locale.
 */
export function formatFileSize(bytes: number, t: Translate): string {
  if (!Number.isFinite(bytes) || bytes < 0) return t('app.notAvailable')
  if (bytes < KIB) return t('app.fileSize.bytes', { size: Math.round(bytes) })
  if (bytes < MIB) return t('app.fileSize.kilobytes', { size: Math.max(1, Math.round(bytes / KIB)) })
  const megabytes = bytes / MIB
  // One decimal is useful up to 10 MB; above that the fraction is noise.
  const size = megabytes >= 10 ? Math.round(megabytes) : Number(megabytes.toFixed(1))
  return t('app.fileSize.megabytes', { size })
}
