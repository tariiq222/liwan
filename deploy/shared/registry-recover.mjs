#!/usr/bin/env node
/**
 * Offline recovery for a stuck tenant-registry publication barrier (#447).
 *
 * The control plane creates `<registry>.pending` before it commits authority changes and removes it after
 * the new snapshot is durable. If the publisher crashes, the barrier stays and every reader fails closed:
 * the guard refuses to start and any running guard answers 503 `tenant_registry_unavailable`.
 *
 * This tool needs no control plane, no database and no network. It:
 *   - requires `--registry <absolute path>`;
 *   - refuses unless the published registry file parses and validates;
 *   - refuses unless `<path>.pending` exists and is a regular file;
 *   - without `--confirm` only prints the plan (dry run);
 *   - with `--confirm` removes ONLY `<path>.pending` and `<path>.publisher-lock`.
 * It never writes, truncates or renames the registry JSON.
 *
 * The operator MUST stop every publisher first: a paused publisher can still resume, and recovery must not
 * race a live writer. `apps/control-plane/src/shared/registry-publisher.ts` states the same rule.
 */
import { lstatSync, readFileSync, unlinkSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
import { validateRegistry } from '../../apps/web/server/utils/tenantRegistry.ts'

const REFUSED = 1
const USAGE = 2

export class RecoveryRefused extends Error {
  constructor(code, detail = '') { super(code); this.code = code; this.detail = detail }
}

/** Reads and validates the published registry; the barrier does not block this check. */
export function verifyRegistry(path) {
  if (!isAbsolute(path)) throw new RecoveryRefused('registry_path_not_absolute', path)
  let bytes
  try { bytes = readFileSync(path, 'utf8') }
  catch (error) {
    if (error.code === 'ENOENT') throw new RecoveryRefused('registry_missing', path)
    throw new RecoveryRefused('registry_unreadable', path)
  }
  let parsed
  try { parsed = JSON.parse(bytes) }
  catch { throw new RecoveryRefused('registry_invalid', 'the registry is not valid JSON') }
  try { return validateRegistry(parsed) }
  catch { throw new RecoveryRefused('registry_invalid', 'the registry does not satisfy the published schema') }
}

function barrierEvidence(path) {
  let stat
  try { stat = lstatSync(path) }
  catch (error) {
    if (error.code === 'ENOENT') throw new RecoveryRefused('barrier_missing', `${path} does not exist`)
    throw new RecoveryRefused('barrier_unreadable', path)
  }
  // completePublication only accepts a regular marker; a symlink (or a directory) is not a publication barrier.
  if (!stat.isFile() || stat.isSymbolicLink()) throw new RecoveryRefused('barrier_invalid', `${path} is not a regular file`)
}

function lockEvidence(path) {
  try {
    const stat = lstatSync(path)
    return stat.isFile() && !stat.isSymbolicLink()
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw new RecoveryRefused('publisher_lock_unreadable', path)
  }
}

/**
 * Plans, and with `confirm` performs, the removal of the two marker files. Returns an audit record;
 * throws RecoveryRefused (or the filesystem error) without touching anything when the precondition fails.
 */
export function recoverRegistry({ registry, confirm = false }) {
  if (typeof registry !== 'string' || !registry) throw new RecoveryRefused('registry_path_required')
  // Only a literal `true` may authorize the destructive path; any other value is a dry run.
  if (confirm !== true && confirm !== false) throw new RecoveryRefused('invalid_confirm')
  const snapshot = verifyRegistry(registry)
  const barrier = `${registry}.pending`
  barrierEvidence(barrier)
  const lock = `${registry}.publisher-lock`
  const hasLock = lockEvidence(lock)
  const plan = { registry, barrier, publisherLock: hasLock ? lock : null, snapshotRevision: snapshot.snapshotRevision, targets: snapshot.targets.length, confirm }
  if (!confirm) return { ...plan, recovered: false, removed: [] }
  // Remove the barrier last: while it exists readers stay closed, even if this process dies mid-recovery.
  if (hasLock) unlinkSync(lock)
  unlinkSync(barrier)
  return { ...plan, recovered: true, removed: [hasLock && lock, barrier].filter(Boolean) }
}

function parseArguments(argv) {
  const options = { registry: undefined, confirm: false, help: false }
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]
    if (argument === '--confirm') options.confirm = true
    else if (argument === '--dry-run') options.confirm = false
    else if (argument === '--help' || argument === '-h') options.help = true
    else if (argument === '--registry') {
      const value = argv[++index]
      if (value === undefined || value.startsWith('--')) throw new RecoveryRefused('registry_path_required')
      options.registry = value
    } else if (argument.startsWith('--registry=')) options.registry = argument.slice('--registry='.length)
    else throw new RecoveryRefused('unknown_argument', argument)
  }
  return options
}

const usage = 'usage: node deploy/shared/registry-recover.mjs --registry <absolute path> [--confirm]'
const refusalText = code => ({
  registry_path_required: 'a registry path is required',
  registry_path_not_absolute: 'the registry path must be absolute',
  registry_missing: 'the registry file does not exist',
  registry_unreadable: 'the registry file cannot be read',
  registry_invalid: 'the registry file is invalid; fix or republish it before removing the barrier',
  barrier_missing: 'there is no publication barrier to recover; nothing was changed',
  barrier_invalid: 'the publication barrier is not a regular file; inspect it manually',
  publisher_lock_unreadable: 'the publisher lock cannot be inspected; stop every publisher first',
  invalid_confirm: 'the confirm flag must be a boolean',
}[code] ?? 'refused')

function main(argv) {
  let options
  try { options = parseArguments(argv) }
  catch (error) {
    console.error(`registry-recover: ${refusalText(error.code)} (${error.code})`)
    console.error(usage)
    return USAGE
  }
  if (options.help) { console.log(usage); return 0 }
  if (!options.registry) {
    console.error('registry-recover: a registry path is required (registry_path_required)')
    console.error(usage)
    return USAGE
  }
  let result
  try { result = recoverRegistry(options) }
  catch (error) {
    if (!(error instanceof RecoveryRefused)) throw error
    console.error(`registry-recover: ${refusalText(error.code)} (${error.code})`)
    if (error.detail) console.error(`  ${error.detail}`)
    return REFUSED
  }
  // One line per fact so an operator log is greppable and the plan is auditable before and after.
  console.log(`registry: ${result.registry}`)
  console.log(`snapshot: revision ${result.snapshotRevision}, ${result.targets} target(s), valid`)
  console.log(`barrier: ${result.barrier}`)
  console.log(`publisher lock: ${result.publisherLock ?? 'absent'}`)
  console.log('the registry JSON is not modified')
  if (!result.recovered) {
    console.log('dry run: stop every registry publisher, then re-run with --confirm to remove these files')
    return 0
  }
  for (const path of result.removed) console.log(`removed: ${path}`)
  console.log('recovered: the registry is published again; restart the guard')
  return 0
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exit(main(process.argv.slice(2)))
