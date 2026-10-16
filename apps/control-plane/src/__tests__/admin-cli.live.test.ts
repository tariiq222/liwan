import { describe, expect, it, beforeAll, beforeEach, afterAll } from 'vitest'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import { migrate } from '../db.js'

const url = process.env.CONTROL_TEST_DATABASE_URL
const root = fileURLToPath(new URL('../..', import.meta.url))
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
        NASQ_CLI_INVENTORY: '/tmp/nasq-cli-test/inventory.json',
        NASQ_CLI_STATE_DIR: '/tmp/nasq-cli-test/state',
        NASQ_REPOSITORY_ROOT: '/tmp/nasq-cli-test/repo',
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
    const first = await runCli(['bootstrap-owner', 'owner@nasq.sa', 'Owner', 'first owner'])
    expect(first.stderr).toBe(''); expect(first.code).toBe(0); expect(first.stdout).toMatch(linkPattern)
    const second = await runCli(['bootstrap-owner', 'other@nasq.sa', 'Other', 'second'])
    expect(second.code).toBe(1); expect(second.stderr).toMatch(/owner already exists/); expect(second.stdout).toBe('')
    const audit = await pool.query("SELECT actor FROM audit_events WHERE action='account.invited' ORDER BY created_at DESC LIMIT 1")
    expect(audit.rows[0].actor).toBe('operator')
  })
  it('refuses to bootstrap when admin sign-in is not configured', async () => {
    const result = await runCli(['bootstrap-owner', 'owner@nasq.sa', 'Owner', 'first owner'], { ADMIN_SECRET_KEY: undefined })
    expect(result.code).toBe(1); expect(result.stdout).toBe('')
  })
  it('prints a reset link for an existing account and refuses unknown emails', async () => {
    await runCli(['bootstrap-owner', 'owner@nasq.sa', 'Owner', 'first owner'])
    const reset = await runCli(['reset-account', 'Owner@nasq.sa', 'locked out'])
    expect(reset.code).toBe(0); expect(reset.stdout).toMatch(linkPattern)
    const unknown = await runCli(['reset-account', 'nobody@nasq.sa', 'locked out'])
    expect(unknown.code).toBe(1); expect(unknown.stdout).toBe('')
  })
  it('no longer accepts grant or revoke', async () => {
    expect((await runCli(['grant', '7', 'vendor.read', 'x'])).code).not.toBe(0)
    expect((await runCli(['revoke', '7', 'x'])).code).not.toBe(0)
  })
})
