import { describe, expect, it, beforeAll, beforeEach, afterAll } from 'vitest'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Pool } from 'pg'
import { migrate } from '../db.js'

const url = process.env.CONTROL_TEST_DATABASE_URL
const root = fileURLToPath(new URL('../..', import.meta.url))
// The import reads the catalog from the repository and runs the repository check against it.
const repositoryRoot = fileURLToPath(new URL('../../../..', import.meta.url))
const linkPattern = /^http:\/\/localhost:3100\/enroll#[A-Za-z0-9_-]{43}\n$/

function runCli(args: string[], env: Record<string, string | undefined> = {}): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['tsx', 'src/admin.ts', ...args], {
      cwd: root,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        USER: process.env.USER,
        CONTROL_DATABASE_URL: url,
        CONTROL_INSTALLATION_ID: 'cli-test-installation',
        CONTROL_SERVICE_KEY: 'k'.repeat(40),
        ADMIN_SECRET_KEY: 's'.repeat(40),
        ADMIN_RP_ID: 'localhost',
        ADMIN_ORIGIN: 'http://localhost:3100',
        LIWAN_CLI_INVENTORY: '/tmp/liwan-cli-test/inventory.json',
        LIWAN_CLI_STATE_DIR: '/tmp/liwan-cli-test/state',
        LIWAN_REPOSITORY_ROOT: '/tmp/liwan-cli-test/repo',
        ...env,
      } as NodeJS.ProcessEnv,
    })
    let stdout = ''; let stderr = ''
    child.stdout.on('data', (d) => { stdout += d }); child.stderr.on('data', (d) => { stderr += d })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

if (!url) describe.skip('admin CLI (requires CONTROL_TEST_DATABASE_URL)', () => {})
else describe('admin CLI', () => {
  const pool = new Pool({ connectionString: url })
  beforeAll(async () => { await migrate(pool) })
  beforeEach(async () => { await pool.query('TRUNCATE vendor_accounts CASCADE') })
  afterAll(async () => { await pool.end() })

  it('bootstraps the first owner once', async () => {
    const first = await runCli(['bootstrap-owner', 'owner@liwanos.com', 'Owner', 'first owner'])
    expect(first.stderr).toBe(''); expect(first.code).toBe(0); expect(first.stdout).toMatch(linkPattern)
    const second = await runCli(['bootstrap-owner', 'other@liwanos.com', 'Other', 'second'])
    expect(second.code).toBe(1); expect(second.stderr).toMatch(/owner already exists/); expect(second.stdout).toBe('')
    const audit = await pool.query("SELECT actor FROM audit_events WHERE action='account.invited' ORDER BY created_at DESC LIMIT 1")
    expect(audit.rows[0].actor).toBe('operator')
  })
  it('refuses to bootstrap when admin sign-in is not configured', async () => {
    const result = await runCli(['bootstrap-owner', 'owner@liwanos.com', 'Owner', 'first owner'], { ADMIN_SECRET_KEY: undefined })
    expect(result.code).toBe(1); expect(result.stdout).toBe('')
  })
  it('prints a reset link for an existing account and refuses unknown emails', async () => {
    await runCli(['bootstrap-owner', 'owner@liwanos.com', 'Owner', 'first owner'])
    const reset = await runCli(['reset-account', 'Owner@liwanos.com', 'locked out'])
    expect(reset.code).toBe(0); expect(reset.stdout).toMatch(linkPattern)
    const unknown = await runCli(['reset-account', 'nobody@liwanos.com', 'locked out'])
    expect(unknown.code).toBe(1); expect(unknown.stdout).toBe('')
  })
  it('no longer accepts grant or revoke', async () => {
    expect((await runCli(['grant', '7', 'vendor.read', 'x'])).code).not.toBe(0)
    expect((await runCli(['revoke', '7', 'x'])).code).not.toBe(0)
  })
  it('imports a validated catalog and stores nothing when the check refuses it', async () => {
    const version = `cli-import-${randomUUID()}`
    const imported = await runCli(['catalog-import', version, 'import a catalog'], { LIWAN_REPOSITORY_ROOT: repositoryRoot })
    expect(imported.code).toBe(0); expect(imported.stderr).toBe('')
    const stored = await pool.query('SELECT id,status FROM catalog_entries WHERE version=$1', [version])
    expect(stored.rows[0].status).toBe('validated')
    expect((await pool.query("SELECT count(*)::int AS count FROM audit_events WHERE action='catalog.imported' AND subject=$1", [stored.rows[0].id])).rows[0].count).toBe(1)

    // Re-importing the same bytes changes nothing and adds no second import event.
    const again = await runCli(['catalog-import', version, 'import a catalog'], { LIWAN_REPOSITORY_ROOT: repositoryRoot })
    expect(again.code).toBe(0)
    expect((await pool.query('SELECT status FROM catalog_entries WHERE version=$1', [version])).rows[0].status).toBe('validated')
    expect((await pool.query("SELECT count(*)::int AS count FROM audit_events WHERE action='catalog.imported' AND subject=$1", [stored.rows[0].id])).rows[0].count).toBe(1)

    const refusedVersion = `cli-refused-${randomUUID()}`
    const refused = await runCli(['catalog-import', refusedVersion, 'import a catalog'], { LIWAN_REPOSITORY_ROOT: repositoryRoot, LIWAN_CLI_PYTHON: '/nonexistent/python3' })
    expect(refused.code).toBe(1); expect(refused.stderr).toMatch(/catalog check failed/)
    expect((await pool.query('SELECT 1 FROM catalog_entries WHERE version=$1', [refusedVersion])).rowCount).toBe(0)

    await pool.query('DELETE FROM audit_events WHERE subject=$1', [stored.rows[0].id])
    await pool.query('DELETE FROM catalog_entries WHERE version=$1', [version])
  }, 120_000)
  it('validates a legacy draft on re-import and refuses different bytes under the same version', async () => {
    const version = `cli-draft-${randomUUID()}`, id = randomUUID()
    const source = readFileSync(join(repositoryRoot, 'deploy/catalog/solutions/platform_v4.json'))
    await pool.query("INSERT INTO catalog_entries(id,version,status,solution,source_sha256) VALUES($1,$2,'draft',$3,$4)", [id, version, JSON.parse(source.toString('utf8')), createHash('sha256').update(source).digest('hex')])

    const reimported = await runCli(['catalog-import', version, 'legacy draft'], { LIWAN_REPOSITORY_ROOT: repositoryRoot })
    expect(reimported.code).toBe(0)
    expect((await pool.query('SELECT status FROM catalog_entries WHERE id=$1', [id])).rows[0].status).toBe('validated')
    expect((await pool.query("SELECT count(*)::int AS count FROM audit_events WHERE action='catalog.validate' AND subject=$1", [id])).rows[0].count).toBe(1)

    // Once lifted there is nothing left to lift: the second pass reports the status and writes no second event.
    const again = await runCli(['catalog-import', version, 'legacy draft'], { LIWAN_REPOSITORY_ROOT: repositoryRoot })
    expect(again.code).toBe(0); expect(again.stderr).toMatch(/already validated; nothing to do/)
    expect((await pool.query("SELECT count(*)::int AS count FROM audit_events WHERE action='catalog.validate' AND subject=$1", [id])).rows[0].count).toBe(1)

    const other = `cli-other-${randomUUID()}`, otherId = randomUUID()
    await pool.query("INSERT INTO catalog_entries(id,version,status,solution,source_sha256) VALUES($1,$2,'draft','{}',$3)", [otherId, other, 'f'.repeat(64)])
    const refused = await runCli(['catalog-import', other, 'different bytes'], { LIWAN_REPOSITORY_ROOT: repositoryRoot })
    expect(refused.code).toBe(1); expect(refused.stderr).toMatch(/different source bytes/)
    expect((await pool.query('SELECT status FROM catalog_entries WHERE version=$1', [other])).rows[0].status).toBe('draft')

    await pool.query('DELETE FROM audit_events WHERE subject = ANY($1::text[])', [[id, otherId]])
    await pool.query('DELETE FROM catalog_entries WHERE id = ANY($1::uuid[])', [[id, otherId]])
  }, 120_000)
})
