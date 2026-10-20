import { recordLinkFor } from '../modules/surfaces'
import { useAccess } from './useAccess'

/** Resolves a record of any application to its route, or null when no application declares the kind or the user may not read it. */
export function useRecordLink() {
  const { can } = useAccess()
  return (kind: string, id: number): string | null => {
    const link = recordLinkFor(kind)
    return link && can(link.capability) ? link.to(id) : null
  }
}
