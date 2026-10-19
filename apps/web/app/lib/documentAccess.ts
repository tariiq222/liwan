import { DocumentAccessUpdateSchema, type DocumentAccess, type DocumentAccessUpdate } from '@webvue/contracts'
export function documentAccessPayload(revision: number, visibility: DocumentAccess['visibility'], grants: DocumentAccess['grants']): DocumentAccessUpdate {
  return DocumentAccessUpdateSchema.parse({ expected_revision: revision, visibility, grants: grants.map(grant => ({ user_id: grant.user.id, access: grant.access })) })
}
