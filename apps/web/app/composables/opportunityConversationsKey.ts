// The cache key of the conversations section of a CRM opportunity. It sits outside both applications' folders because the
// inbox changes which opportunity a conversation belongs to and must refresh that section without importing CRM code.
export const opportunityConversationsKey = (opportunityId: number) => ['crm', 'opportunities', 'conversations', opportunityId] as const
