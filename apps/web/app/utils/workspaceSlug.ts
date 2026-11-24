// The client's quick read of a workspace address before it asks the server. The full rule, including the reserved
// names, lives in packages/commercial-contracts/src/workspace-slug.ts and is enforced by the control plane; this file
// only avoids a round trip for an address that cannot be valid and proposes one from what the visitor already typed.

const SHAPE = /^[a-z0-9](?:[a-z0-9]|-(?!-))*[a-z0-9]$/
const MIN = 3
const MAX = 30

export function workspaceSlugShapeOk(slug: string): boolean {
  return slug.length >= MIN && slug.length <= MAX && SHAPE.test(slug) && !/^[0-9]+$/.test(slug)
}

function asSlug(words: string): string {
  return words.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, MAX).replace(/-+$/, '')
}

/** A first address: the Latin words of the company name, else the email domain's first label, else nothing. */
export function suggestWorkspaceSlug(companyName: string, email: string): string {
  const fromName = asSlug(companyName)
  if (workspaceSlugShapeOk(fromName)) return fromName
  const domain = email.trim().toLowerCase().split('@')[1]?.split('.')[0] ?? ''
  const fromDomain = asSlug(domain)
  return workspaceSlugShapeOk(fromDomain) ? fromDomain : ''
}
