import type { IntegrationConnection, IntegrationConnectionList } from '@liwan/contracts'

/** The list with one connection replaced by the server's answer; a connection not in the list is appended. */
export function storeConnection(list: IntegrationConnectionList | undefined, connection: IntegrationConnection): IntegrationConnectionList | undefined {
  if (!list) return list
  if (!list.items.some(item => item.ref === connection.ref)) return { ...list, items: [...list.items, connection], total: list.total + 1 }
  return { ...list, items: list.items.map(item => (item.ref === connection.ref ? connection : item)) }
}

/** The list without the connection (disconnected). */
export function dropConnection(list: IntegrationConnectionList | undefined, ref: string): IntegrationConnectionList | undefined {
  if (!list) return list
  const items = list.items.filter(item => item.ref !== ref)
  return { ...list, items, total: list.total - (list.items.length - items.length) }
}

/** The body of a secret replacement or create: only the fields the customer typed, trimmed. */
export function typedValues(typed: Readonly<Record<string, string>>): Record<string, string> {
  const values: Record<string, string> = {}
  for (const [name, value] of Object.entries(typed)) {
    const trimmed = value.trim()
    if (trimmed) values[name] = trimmed
  }
  return values
}
