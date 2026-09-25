import { writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'

const [baseUrl, evidencePath, credentialFile, expectedNuxtPid] = process.argv.slice(2)
const secrets = Object.fromEntries((await (await import('node:fs/promises')).readFile(credentialFile, 'utf8')).trim().split('\n').map(line => line.split(/=(.*)/s).slice(0, 2)))
const login = secrets.NASQ_FIXTURE_ADMIN_LOGIN
const password = secrets.NASQ_FIXTURE_ADMIN_PASSWORD
const marker = secrets.NASQ_FIXTURE_MARKER
if (!baseUrl || !evidencePath || !credentialFile || !login || !password || !marker || !expectedNuxtPid) throw new Error('fixture inputs are required')
const url = new URL(baseUrl)
if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.port !== '13109') throw new Error('probe target must be exact fixture loopback URL')
const evidence = { schema_version: 1, base_url: baseUrl, started_at: new Date().toISOString(), fixture_identity: { expected_nuxt_pid: Number(expectedNuxtPid), db: 'nasq_scratch_p1outage', marker: 'redacted-present' }, checks: [] }
const cookieJar = new Map()

async function request(path, { method = 'GET', body, expected, label }) {
  const headers = { accept: 'application/json' }
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (cookieJar.size) headers.cookie = [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
  const response = await fetch(new URL(path, baseUrl), {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual',
  })
  for (const cookie of response.headers.getSetCookie()) {
    const [pair] = cookie.split(';')
    const index = pair.indexOf('=')
    if (index > 0) cookieJar.set(pair.slice(0, index), pair.slice(index + 1))
  }
  const text = await response.text()
  let payload = null
  try { payload = text ? JSON.parse(text) : null } catch { /* sanitized summary only */ }
  const ok = response.status === expected
  evidence.checks.push({ label, method, path, status: response.status, expected_status: expected, passed: ok })
  if (!ok) {
    evidence.result = 'business_baseline_failed'
    evidence.failed_at = label
    evidence.finished_at = new Date().toISOString()
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
    throw new Error(`${label} failed with HTTP ${response.status}; body omitted`)
  }
  return payload
}

const session = await request('/api/auth/login', { method: 'POST', body: { login, password }, expected: 200, label: 'synthetic_admin_login' })
if (session?.ok !== true) throw new Error('synthetic admin login was not accepted')
await request('/api/v1/me', { expected: 200, label: 'authenticated_me' })
const projectList = await request('/api/v1/projects', { expected: 200, label: 'projects_read' })
if (!Array.isArray(projectList?.items)) throw new Error('projects list envelope invalid')
const departmentList = await request('/api/v1/hr/departments', { expected: 200, label: 'hr_departments_read' })
if (!Array.isArray(departmentList?.items) || !departmentList.items.some(item => item.name === marker)) throw new Error('scratch DB marker is absent from Nuxt→HR read')
const employees = await request('/api/v1/hr/employees', { expected: 200, label: 'hr_employees_read' })
if (!Array.isArray(employees?.items)) throw new Error('employee list envelope invalid')

const suffix = randomUUID()
const project = await request('/api/v1/projects', {
  method: 'POST', body: { name: `Outage fixture ${suffix}`, date_end: '2035-12-31' },
  expected: 201, label: 'project_create',
})
if (!Number.isSafeInteger(project?.id)) throw new Error('project create returned no ID')
const task = await request('/api/v1/tasks', {
  method: 'POST', body: { name: `Outage task ${suffix}`, project_id: project.id },
  expected: 201, label: 'task_create',
})
if (!Number.isSafeInteger(task?.id)) throw new Error('task create returned no ID')
const department = await request('/api/v1/hr/departments', {
  method: 'POST', body: { name: `Outage department ${suffix}` },
  expected: 201, label: 'hr_department_create',
})
if (!Number.isSafeInteger(department?.id)) throw new Error('department create returned no ID')
const employee = await request('/api/v1/hr/employees', {
  method: 'POST', body: { name: `Outage employee ${suffix}`, work_email: `outage-${suffix}@example.test`, department_id: department.id },
  expected: 201, label: 'hr_employee_create',
})
if (!Number.isSafeInteger(employee?.id)) throw new Error('employee create returned no ID')
await request(`/api/v1/hr/employees/${employee.id}`, {
  method: 'PATCH', body: { job_title: 'Continuity fixture' }, expected: 200, label: 'hr_employee_patch',
})
const projectCheck = await request(`/api/v1/projects/${project.id}`, { expected: 200, label: 'project_read_after_write' })
if (projectCheck?.id !== project.id) throw new Error('project detail did not match created ID')
const hrCheck = await request(`/api/v1/hr/employees/${employee.id}`, { expected: 200, label: 'hr_employee_read_after_write' })
if (hrCheck?.id !== employee.id || hrCheck?.job_title !== 'Continuity fixture') throw new Error('HR detail did not reflect write')

evidence.finished_at = new Date().toISOString()
evidence.result = 'business_baseline_pass'
evidence.created_ids = { project_id: project.id, task_id: task.id, department_id: department.id, employee_id: employee.id }
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
console.log(`baseline passed: ${evidence.checks.length} authenticated BFF checks; IDs saved only to private evidence file`)
