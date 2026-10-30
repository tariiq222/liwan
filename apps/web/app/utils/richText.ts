import { sanitizeHtml } from '@liwan/ui/app/utils/sanitize'

/** True when HTML carries visible text once tags and non-breaking spaces are removed. */
export function richTextHasContent(html: string | null | undefined): boolean {
  if (!html) return false
  return sanitizeHtml(html)
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .trim().length > 0
}
