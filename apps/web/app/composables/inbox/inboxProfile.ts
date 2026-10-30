import {
  InboxBusinessProfilePatchSchema, InboxBusinessVerticalSchema,
  type InboxBusinessProfile, type InboxBusinessProfilePatch, type InboxBusinessVertical,
} from '@liwan/contracts'

// The form state of the WhatsApp business profile and its mapping to Meta's limits. Meta is the only store: a draft is
// built from the profile read live, and only the fields the user changed are sent.

export const PROFILE_LIMITS = { about: 139, address: 256, description: 512, email: 128, website: 256 } as const
export const PROFILE_VERTICALS: readonly InboxBusinessVertical[] = InboxBusinessVerticalSchema.options

/** Text fields hold what is typed; `vertical` is '' for "not set". */
export interface ProfileDraft {
  about: string
  address: string
  description: string
  email: string
  website1: string
  website2: string
  vertical: InboxBusinessVertical | ''
}

export type ProfileField = keyof ProfileDraft
const FIELDS: readonly ProfileField[] = ['about', 'address', 'description', 'email', 'website1', 'website2', 'vertical']

export function profileToDraft(profile: InboxBusinessProfile): ProfileDraft {
  return {
    about: profile.about ?? '',
    address: profile.address ?? '',
    description: profile.description ?? '',
    email: profile.email ?? '',
    website1: profile.websites[0] ?? '',
    website2: profile.websites[1] ?? '',
    vertical: profile.vertical ?? '',
  }
}

export const changedProfileFields = (base: ProfileDraft, draft: ProfileDraft): ProfileField[] => FIELDS.filter(field => base[field] !== draft[field])

/** A fresh profile (after a save or a picture upload) replaces every field the user has not edited since `before`. */
export function mergeDraft(draft: ProfileDraft, before: ProfileDraft, after: ProfileDraft): ProfileDraft {
  const next = { ...draft }
  for (const field of FIELDS) {
    if (draft[field] === before[field]) (next as Record<ProfileField, string>)[field] = after[field]
  }
  return next
}

/** Only what changed, shaped for the contract; a cleared vertical is null, a cleared text is the empty string. */
export function draftPatch(base: ProfileDraft, draft: ProfileDraft): InboxBusinessProfilePatch {
  const changed = new Set(changedProfileFields(base, draft))
  const websites = [draft.website1.trim(), draft.website2.trim()].filter(Boolean)
  return {
    ...(changed.has('about') ? { about: draft.about.trim() } : {}),
    ...(changed.has('address') ? { address: draft.address.trim() } : {}),
    ...(changed.has('description') ? { description: draft.description.trim() } : {}),
    ...(changed.has('email') ? { email: draft.email.trim() } : {}),
    ...(changed.has('website1') || changed.has('website2') ? { websites } : {}),
    ...(changed.has('vertical') ? { vertical: draft.vertical || null } : {}),
  }
}

/** The fields whose value Meta would refuse, found by running the contract on the changed fields. */
export function profileErrors(base: ProfileDraft, draft: ProfileDraft): Set<ProfileField> {
  const errors = new Set<ProfileField>()
  const changed = new Set(changedProfileFields(base, draft))
  const { websites: _websites, ...textPatch } = draftPatch(base, draft)
  const parsed = InboxBusinessProfilePatchSchema.omit({ websites: true }).safeParse(textPatch)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path[0]
      if (field === 'about' || field === 'address' || field === 'description' || field === 'email') errors.add(field)
    }
  }
  for (const field of ['website1', 'website2'] as const) {
    const value = draft[field].trim()
    if (changed.has(field) && value && !(value.length <= PROFILE_LIMITS.website && /^https?:\/\/\S+$/.test(value))) errors.add(field)
  }
  return errors
}
