import type { AppCommand } from '../../modules/types'

/** Quick-access pills on home, including the standing services link. The rest stay in the palette and `/apps`. */
export const HOME_QUICK_LIMIT = 5

/** The application a command belongs to: its id is `<manifest id>.<name>`. */
const ownerOf = (command: AppCommand): string => command.id.split('.')[0] ?? command.id

/**
 * The commands home offers, at most `limit`, from the ones the user may run (already in rail order). Each application
 * gets its first command before any gets a second, so a user with many applications sees a spread rather than the
 * first application's forms; inside a round the rail order decides. The same input always gives the same output.
 */
export function homeQuickActions(commands: readonly AppCommand[], limit: number = HOME_QUICK_LIMIT): AppCommand[] {
  const byOwner = new Map<string, AppCommand[]>()
  for (const command of commands) byOwner.set(ownerOf(command), [...(byOwner.get(ownerOf(command)) ?? []), command])
  const queues = [...byOwner.values()]
  const picked: AppCommand[] = []
  for (let round = 0; picked.length < limit && queues.some(queue => queue.length > round); round++) {
    for (const queue of queues) {
      if (picked.length < limit && queue[round]) picked.push(queue[round]!)
    }
  }
  return picked
}
